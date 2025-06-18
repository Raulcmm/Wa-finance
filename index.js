// 1. Carga de módulos y configuración inicial
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const PORT = process.env.PORT || 3000;
const app = express();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN no está definido en las variables de entorno.');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// 2. Conexión a MongoDB Atlas
// Variable para rastrear el estado de la conexión a la base de datos
let isDbConnected = false;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB Atlas');
    isDbConnected = true; // La conexión está lista
  })
  .catch(err => {
    console.error('Error FATAL al conectar a MongoDB:', err.message);
    isDbConnected = false; // La conexión falló al inicio
    // Considera si quieres salir aquí o intentar continuar sin DB
    // process.exit(1);
  });

// Manejo de eventos de conexión/desconexión para actualizar el estado
mongoose.connection.on('connected', () => {
  console.log('Mongoose default connection open to DB');
  isDbConnected = true;
});

mongoose.connection.on('error', err => {
  console.error('Mongoose default connection error:', err.message);
  isDbConnected = false;
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose default connection disconnected');
  isDbConnected = false;
});

// 3. Definición del Modelo de Gasto (Esquema de Mongoose)
const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', expenseSchema);

// 4. Middleware de Express
app.use(express.json());

// 5. Configuración del Webhook de Telegram
const RENDER_APP_URL = process.env.VERCEL_APP_URL;

if (!RENDER_APP_URL) {
  console.error('Error: VERCEL_APP_URL no está definida en las variables de entorno.');
  process.exit(1);
}

// const webHookUrl = `${RENDER_APP_URL}/bot${TELEGRAM_BOT_TOKEN}`;
const webHookUrl = `<span class="math-inline">\{RENDER\_APP\_URL\}/bot</span>{TELEGRAM_BOT_TOKEN}`;

bot.setWebHook(webHookUrl)
  .then(() => console.log(`Webhook de Telegram configurado en: ${webHookUrl}`))
  .catch(err => {
    console.error(`Error al configurar el webhook de Telegram: ${err.message}. Asegúrate de que el token es correcto y la VERCEL_APP_URL es accesible.`);
  });

// 6. Ruta de Express para recibir las actualizaciones del Webhook de Telegram
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  if (req.body) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200);
});
// ... (tu código anterior hasta la sección 7. Manejador de mensajes del bot de Telegram)

// 7. Manejador de mensajes del bot de Telegram
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const incomingMsg = (msg.text || '').toLowerCase().trim();

  console.log(`Mensaje recibido en Telegram de ${chatId}: "${incomingMsg}"`);

  // ***** OPTIMIZACIÓN DE EXPERIENCIA DE USUARIO DURANTE COLD START *****
  // Verificar si la base de datos está conectada antes de intentar cualquier operación
  if (!isDbConnected) {
    console.warn('Operación de DB solicitada, pero la base de datos NO está conectada.');
    // Mensaje para informar al usuario que el bot está arrancando
    await bot.sendMessage(chatId, '⌛️ Estoy arrancando... Por favor, espera un momento y vuelve a enviar tu mensaje.');
    return; // Detiene el procesamiento del mensaje aquí
  }
  // ********************************************************************

  const expenseRegex = /^(gasto|gasté|gastos?)\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
  const match = incomingMsg.match(expenseRegex);

  try {
    // ... el resto de tu lógica de bot (la misma que ya tenías) ...
    if (match) {
      const amount = parseFloat(match[2]);
      const category = match[4].trim();

      const newExpense = new Expense({ amount, category });
      await newExpense.save(); 

      await bot.sendMessage(chatId, `✅ Gasto de *$${amount.toFixed(2)}* en "${category}" registrado con éxito.`, { parse_mode: 'Markdown' });
      console.log(`Gasto registrado: ${amount} - ${category}`);

    } else if (incomingMsg === 'resumen') {
      const expenses = await Expense.find({}); 

      if (expenses.length === 0) {
        await bot.sendMessage(chatId, 'Aún no tienes gastos registrados.');
      } else {
        const summary = new Map();
        expenses.forEach(expense => {
          const cat = expense.category.toLowerCase();
          summary.set(cat, (summary.get(cat) || 0) + expense.amount);
        });

        let summaryMessage = '📊 *Resumen de tus gastos:*\n';
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
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
        await bot.sendMessage(chatId, '❌ Lo siento, la conexión con la base de datos se perdió temporalmente. Por favor, intenta de nuevo en unos segundos.');
    } else {
        await bot.sendMessage(chatId, '❌ Lo siento, hubo un error inesperado al procesar tu solicitud. Por favor, intenta de nuevo más tarde.');
    }
  }
});

// ... (el resto de tu código)

// 8. Iniciar el Servidor Express
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});