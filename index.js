// 1. Carga de módulos y configuración inicial
require('dotenv').config(); // Carga las variables de entorno del archivo .env
const express = require('express'); // Framework web para Node.js
const mongoose = require('mongoose'); // ODM (Object Data Modeling) para MongoDB
const TelegramBot = require('node-telegram-bot-api'); // Librería para interactuar con la API de Telegram

// Configura el puerto en el que escuchará el servidor Express.
const PORT = process.env.PORT || 3000;
const app = express(); // Crea una instancia de la aplicación Express

// Obtén el token del bot de Telegram de las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Si el token no está definido, sal del proceso. ¡CRÍTICO para la seguridad y funcionamiento!
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN no está definido en las variables de entorno.');
  process.exit(1); // Sale de la aplicación si el token no está configurado
}

// Crea una nueva instancia del bot de Telegram.
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// 2. Conexión a MongoDB Atlas
// Añadimos más opciones para una conexión robusta y un mejor manejo de errores inicial
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB Atlas');
  })
  .catch(err => {
    console.error('Error FATAL al conectar a MongoDB:', err.message);
    // Podrías decidir salir si la DB es crítica para iniciar
    // process.exit(1);
  });

// Opcional: Manejo de errores de conexión después de la conexión inicial
mongoose.connection.on('error', err => {
  console.error('Error de conexión a MongoDB después del inicio:', err.message);
});

// 3. Definición del Modelo de Gasto (Esquema de Mongoose)
const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', expenseSchema);

// 4. Middleware de Express
app.use(express.json()); // Telegram envía el cuerpo de la petición como JSON

// 5. Configuración del Webhook de Telegram
// Asegúrate de que VERCEL_APP_URL esté definida
const VERCEL_APP_URL = process.env.VERCEL_APP_URL;
if (!VERCEL_APP_URL) {
  console.error('Error: VERCEL_APP_URL no está definida en las variables de entorno.');
  process.exit(1); // La URL es crítica para el webhook
}

const webHookUrl = `${VERCEL_APP_URL}/bot${TELEGRAM_BOT_TOKEN}`;

bot.setWebHook(webHookUrl)
  .then(() => console.log(`Webhook de Telegram configurado en: ${webHookUrl}`))
  .catch(err => {
    console.error(`Error al configurar el webhook de Telegram: ${err.message}`);
    // Un 401 aquí significa token inválido, aunque ya lo chequeamos al inicio
    // Podría ser también un problema de URL inaccesible desde Telegram
  });

// 6. Ruta de Express para recibir las actualizaciones del Webhook de Telegram
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  // Asegurarse de que el cuerpo de la petición no esté vacío antes de procesar
  if (req.body) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200); // Siempre responde con 200 OK a Telegram
});

// 7. Manejador de mensajes del bot de Telegram
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  // Usamos un valor predeterminado si msg.text es undefined/null para evitar errores
  const incomingMsg = (msg.text || '').toLowerCase().trim();

  console.log(`Mensaje recibido en Telegram de ${chatId}: "${incomingMsg}"`);

  const expenseRegex = /^(gasto|gasté|gastos?)\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
  const match = incomingMsg.match(expenseRegex);

  try {
    if (match) {
      const amount = parseFloat(match[2]);
      const category = match[4].trim();

      const newExpense = new Expense({ amount, category });
      await newExpense.save();

      await bot.sendMessage(chatId, `✅ Gasto de *$${amount.toFixed(2)}* en "${category}" registrado con éxito.`, { parse_mode: 'Markdown' });
      console.log(`Gasto registrado: ${amount} - ${category}`);

    } else if (incomingMsg === 'resumen') {
      // Uso de populate('expenses') no es necesario aquí ya que no tienes relaciones
      const expenses = await Expense.find({});

      if (expenses.length === 0) {
        await bot.sendMessage(chatId, 'Aún no tienes gastos registrados.');
      } else {
        const summary = new Map(); // Usamos Map para un resumen más eficiente
        expenses.forEach(expense => {
          const cat = expense.category.toLowerCase();
          summary.set(cat, (summary.get(cat) || 0) + expense.amount);
        });

        let summaryMessage = '📊 *Resumen de tus gastos:*\n';
        // Iteramos sobre el Map para construir el mensaje
        for (const [cat, totalAmount] of summary) {
          summaryMessage += `• ${cat.charAt(0).toUpperCase() + cat.slice(1)}: *$${totalAmount.toFixed(2)}*\n`;
        }
        const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        summaryMessage += `\n*Total Gasto: $${total.toFixed(2)}*`;

        await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
        console.log('Resumen de gastos enviado.');
      }
    } else {
      await bot.sendMessage(chatId, '👋 ¡Hola! Soy tu bot de finanzas de Telegram.\n\nPuedes enviarme:\n\n* "gasto [cantidad] [categoría]" (ej. "gasto 150 comida") para registrar un gasto.\n* "resumen" para ver tus gastos totales por categoría.', { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Error al procesar el mensaje o guardar el gasto:', error);
    await bot.sendMessage(chatId, '❌ Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde.');
  }
});

// 8. Iniciar el Servidor Express
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});