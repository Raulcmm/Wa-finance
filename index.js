require('dotenv').config(); // Cargar variables de entorno del archivo .env
const express = require('express');
const mongoose = require('mongoose');
const { MessagingResponse } = require('twilio').twiml; // Para construir respuestas de Twilio

const app = express();
const PORT = process.env.PORT || 3000;

// --- Conexión a MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch(err => console.error('Error al conectar a MongoDB:', err));

// --- Definir el Modelo de Gasto ---
const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now },
  description: String, // Opcional: podrías usarlo para guardar la descripción completa
  whatsappNumber: String // Para identificar al usuario (tu número de WhatsApp)
});
const Expense = mongoose.model('Expense', expenseSchema);

// --- Middlewares de Express ---
// Para parsear el cuerpo de las solicitudes, especialmente de Twilio
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Ruta para el Webhook de WhatsApp ---
app.post('/webhook/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const incomingMsg = req.body.Body ? req.body.Body.toLowerCase().trim() : ''; // El mensaje de WhatsApp
  const fromNumber = req.body.From; // El número de WhatsApp que envió el mensaje (tu número)

  console.log(`Mensaje recibido de ${fromNumber}: "${incomingMsg}"`);

  // --- Lógica del Bot para registrar gastos ---
  // Ejemplo de formato esperado: "gasto 500 comida" o "gasté 1200 transporte"
  const expenseRegex = /^(gasto|gasté|gastos?)\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
  const match = incomingMsg.match(expenseRegex);

  if (match) {
    const amount = parseFloat(match[2]);
    const category = match[4].trim(); // La parte final del mensaje es la categoría

    try {
      const newExpense = new Expense({
        amount,
        category,
        whatsappNumber: fromNumber // Guarda el número para poder filtrar gastos por usuario
      });
      await newExpense.save(); // Guarda el gasto en MongoDB
      twiml.message(`¡Gasto de $${amount.toFixed(2)} en '${category}' registrado! ✅`);
    } catch (error) {
      console.error('Error al guardar el gasto:', error);
      twiml.message('Hubo un error al registrar tu gasto. Por favor, inténtalo de nuevo.');
    }
  } else if (incomingMsg === 'resumen' || incomingMsg === 'mis gastos') {
      // --- Lógica para consultar gastos (Ejemplo: total por categoría este mes) ---
      try {
          const today = new Date();
          const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
          const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Último día del mes actual

          const monthlyExpenses = await Expense.aggregate([
              { $match: { whatsappNumber: fromNumber, date: { $gte: startOfMonth, $lte: endOfMonth } } },
              { $group: { _id: '$category', total: { $sum: '$amount' } } },
              { $sort: { _id: 1 } } // Ordenar por categoría
          ]);

          if (monthlyExpenses.length > 0) {
              let summary = 'Resumen de tus gastos este mes:\n';
              monthlyExpenses.forEach(exp => {
                  summary += `- ${exp._id}: $${exp.total.toFixed(2)}\n`;
              });
              twiml.message(summary);
          } else {
              twiml.message('No tienes gastos registrados este mes. ¡Empieza a registrar!');
          }

      } catch (error) {
          console.error('Error al generar el resumen:', error);
          twiml.message('No pude generar tu resumen de gastos. Algo salió mal.');
      }
  } else {
    // Mensaje por defecto si no entiende el comando
    twiml.message(
      '¡Hola! Soy tu bot de finanzas. Para registrar un gasto, usa "gasto [monto] [categoría]". Ejemplo: "gasto 500 comida".\n' +
      'Para ver un resumen, escribe "resumen".'
    );
  }

  // --- Enviar la respuesta a Twilio ---
  res.writeHead(200, { 'Content-Type': 'text/xml' }); // Twilio espera XML como respuesta
  res.end(twiml.toString());
});

// --- Iniciar el servidor Express ---
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
  console.log(`Abra ngrok y apunte a este puerto: ngrok http ${PORT}`);
});