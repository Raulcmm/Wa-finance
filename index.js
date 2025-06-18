// 1. Carga de módulos y configuración inicial
require('dotenv').config(); // Carga las variables de entorno del archivo .env
const express = require('express'); // Framework web para Node.js
const mongoose = require('mongoose'); // ODM (Object Data Modeling) para MongoDB
const TelegramBot = require('node-telegram-bot-api'); // Librería para interactuar con la API de Telegram

// Configura el puerto en el que escuchará el servidor Express.
// Usa el puerto que Vercel le asigne (process.env.PORT) o el 3000 si está en local.
const PORT = process.env.PORT || 3000;
const app = express(); // Crea una instancia de la aplicación Express

// Obtén el token del bot de Telegram de las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Crea una nueva instancia del bot de Telegram.
// NOTA: No le pasamos el "polling: true" aquí porque usaremos webhooks en Vercel.
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// 2. Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch(err => console.error('Error al conectar a MongoDB:', err));

// 3. Definición del Modelo de Gasto (Esquema de Mongoose)
// Este es el plano de cómo se guardarán los datos de un gasto en tu base de datos.
const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true }, // Cantidad del gasto, obligatoria
  category: { type: String, required: true }, // Categoría del gasto, obligatoria
  date: { type: Date, default: Date.now } // Fecha del gasto, por defecto la fecha actual
});
const Expense = mongoose.model('Expense', expenseSchema); // Crea el modelo 'Expense' a partir del esquema

// 4. Middleware de Express
// Necesario para que Express pueda leer los datos que Telegram envía en el cuerpo de la petición POST.
app.use(express.json()); // Telegram envía el cuerpo de la petición como JSON

// 5. Configuración del Webhook de Telegram
// Cuando el bot se despliegue en Vercel, Telegram enviará las actualizaciones a esta URL.
// NOTA: Reemplaza 'YOUR_VERCEL_APP_URL' con la URL real de tu despliegue en Vercel
// Ejemplo: https://wa-finance-ejjiucwov-ral-camachos-projects.vercel.app
const VERCEL_APP_URL = process.env.VERCEL_APP_URL; // Asegúrate de definir esta variable en Vercel
const webHookUrl = `${VERCEL_APP_URL}/bot${TELEGRAM_BOT_TOKEN}`;

// Establece el webhook de Telegram. Esto le dice a Telegram dónde enviar las actualizaciones.
bot.setWebHook(webHookUrl)
  .then(() => console.log(`Webhook de Telegram configurado en: ${webHookUrl}`))
  .catch(err => console.error('Error al configurar el webhook de Telegram:', err));

// 6. Ruta de Express para recibir las actualizaciones del Webhook de Telegram
// Telegram enviará las actualizaciones (mensajes, etc.) a esta ruta.
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  // Procesa la actualización que Telegram envió al webhook
  bot.processUpdate(req.body);
  // Responde inmediatamente con un 200 OK a Telegram para indicar que la actualización fue recibida
  res.sendStatus(200);
});

// 7. Manejador de mensajes del bot de Telegram
// Esta función se ejecuta cada vez que el bot recibe un mensaje de un usuario.
bot.on('message', async (msg) => {
  const chatId = msg.chat.id; // El ID del chat para enviar respuestas de vuelta
  const incomingMsg = msg.text ? msg.text.toLowerCase().trim() : ''; // El texto del mensaje del usuario (en minúsculas y sin espacios extra)

  console.log(`Mensaje recibido en Telegram de ${chatId}: "${incomingMsg}"`); // Log para depuración

  // Expresión regular para detectar el formato de "gasto [cantidad] [categoría]"
  // Ejemplos: "gasto 150 comida", "gasté 20 transporte", "gastos 50 cafe"
  const expenseRegex = /^(gasto|gasté|gastos?)\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
  const match = incomingMsg.match(expenseRegex); // Intenta hacer coincidir el mensaje con la regex

  try {
    if (match) {
      // Si el mensaje coincide con el formato de gasto
      const amount = parseFloat(match[2]); // Extrae la cantidad (ej. 150)
      const category = match[4].trim(); // Extrae la categoría (ej. "comida")

      // Crea una nueva instancia del modelo de Gasto
      const newExpense = new Expense({ amount, category });
      await newExpense.save(); // Guarda el gasto en MongoDB

      // Responde al usuario confirmando el registro de gasto
      await bot.sendMessage(chatId, `✅ Gasto de *$${amount.toFixed(2)}* en "${category}" registrado con éxito.`, { parse_mode: 'Markdown' });
      console.log(`Gasto registrado: ${amount} - ${category}`);

    } else if (incomingMsg === 'resumen') {
      // Si el usuario pide un resumen
      const expenses = await Expense.find({}); // Busca todos los gastos en la base de datos

      if (expenses.length === 0) {
        // Si no hay gastos registrados
        await bot.sendMessage(chatId, 'Aún no tienes gastos registrados.');
      } else {
        // Si hay gastos, calcula el resumen por categoría
        const summary = {};
        expenses.forEach(expense => {
          const cat = expense.category.toLowerCase();
          summary[cat] = (summary[cat] || 0) + expense.amount;
        });

        // Construye el mensaje de resumen
        let summaryMessage = '📊 *Resumen de tus gastos:*\n';
        for (const cat in summary) {
          // Formato Markdown para Telegram
          summaryMessage += `• ${cat.charAt(0).toUpperCase() + cat.slice(1)}: *$${summary[cat].toFixed(2)}*\n`;
        }
        const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        summaryMessage += `\n*Total Gasto: $${total.toFixed(2)}*`;

        // Envía el resumen al usuario, indicando que use Markdown para el formato
        await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
        console.log('Resumen de gastos enviado.');
      }
    } else {
      // Si el mensaje no coincide con ningún comando conocido
      await bot.sendMessage(chatId, '👋 ¡Hola! Soy tu bot de finanzas de Telegram.\n\nPuedes enviarme:\n\n* "gasto [cantidad] [categoría]" (ej. "gasto 150 comida") para registrar un gasto.\n* "resumen" para ver tus gastos totales por categoría.', { parse_mode: 'Markdown' });
    }
  } catch (error) {
    // Manejo de errores: si algo falla en la lógica, responde con un mensaje de error y loguea el error.
    console.error('Error al procesar el mensaje o guardar el gasto:', error);
    await bot.sendMessage(chatId, '❌ Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde.');
  }
});

// 8. Iniciar el Servidor Express
// El servidor Express empieza a escuchar peticiones en el puerto configurado.
// Esto es necesario para que Vercel pueda recibir los webhooks de Telegram.
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});