// 1. Módulos y configuración
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const { TELEGRAM_BOT_TOKEN, MONGO_URI, RENDER_APP_URL } = process.env;

if (!TELEGRAM_BOT_TOKEN || !RENDER_APP_URL) {
  console.error('❌ Error: Faltan variables de entorno (TELEGRAM_BOT_TOKEN o RENDER_APP_URL).');
  process.exit(1);
}

// 2. Inicializar bot con polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// 3. Conexión a MongoDB Atlas
let isDbConnected = false;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => {
    console.error('❌ Error al conectar a MongoDB:', err.message);
    isDbConnected = false;
  });

mongoose.connection.on('connected', () => {
  console.log('🟢 Mongoose conectado');
  isDbConnected = true;
});
mongoose.connection.on('error', err => {
  console.error('🔴 Mongoose error:', err.message);
  isDbConnected = false;
});
mongoose.connection.on('disconnected', () => {
  console.log('🟡 Mongoose desconectado');
  isDbConnected = false;
});

// 4. Modelo de Gasto
const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now },
});
const Expense = mongoose.model('Expense', expenseSchema);

// 5. Middleware de Express
app.use(express.json());

// 6. Webhook para Telegram
const webHookUrl = `${RENDER_APP_URL}/bot${TELEGRAM_BOT_TOKEN}`;
bot.setWebHook(webHookUrl)
  .then(() => console.log(`📬 Webhook configurado en: ${webHookUrl}`))
  .catch(err => console.error('❌ Error al configurar webhook:', err.message));

app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  if (req.body) bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 7. Lógica del Bot
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const incomingMsg = (msg.text || '').toLowerCase().trim();

  console.log(`📩 Mensaje de ${chatId}: "${incomingMsg}"`);

  if (!isDbConnected) {
    console.warn('⏳ DB aún no disponible.');
    await bot.sendMessage(chatId, '⌛️ Estoy arrancando... Intenta en unos segundos.');
    return;
  }

  const expenseRegex = /^(gasto|gasté|gastos?)\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
  const match = incomingMsg.match(expenseRegex);

  try {
    if (match) {
      const amount = parseFloat(match[2]);
      const category = match[4].trim();

      const newExpense = new Expense({ amount, category });
      await newExpense.save();

      await bot.sendMessage(chatId,
        `✅ Gasto de *$${amount.toFixed(2)}* en "${category}" registrado con éxito.`,
        { parse_mode: 'Markdown' });

      console.log(`💾 Gasto registrado: $${amount} - ${category}`);
    } else if (incomingMsg === 'resumen') {
      const expenses = await Expense.find({});
      if (expenses.length === 0) {
        await bot.sendMessage(chatId, '📭 Aún no tienes gastos registrados.');
        return;
      }

      const summary = expenses.reduce((map, { category, amount }) => {
        const key = category.toLowerCase();
        map[key] = (map[key] || 0) + amount;
        return map;
      }, {});

      let message = '📊 *Resumen de tus gastos:*\n';
      for (const [cat, total] of Object.entries(summary)) {
        message += `• ${cat.charAt(0).toUpperCase() + cat.slice(1)}: *$${total.toFixed(2)}*\n`;
      }

      const total = expenses.reduce((sum, { amount }) => sum + amount, 0);
      message += `\n*Total Gasto: $${total.toFixed(2)}*`;

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      console.log('📈 Resumen enviado.');
    } else {
      await bot.sendMessage(chatId,
        '👋 ¡Hola! Soy tu bot de finanzas.\n\n' +
        'Puedes enviarme:\n' +
        '• `gasto [cantidad] [categoría]` (ej. "gasto 150 comida")\n' +
        '• `resumen` para ver tus gastos',
        { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('❌ Error al manejar mensaje:', error);
    const msg = (error.name === 'MongooseError' && error.message.includes('buffering'))
      ? '❌ Problema temporal con la base de datos. Intenta de nuevo en unos segundos.'
      : '❌ Ocurrió un error inesperado. Por favor, intenta más tarde.';
    await bot.sendMessage(chatId, msg);
  }
});

// 8. Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Express activo en puerto ${PORT}`);
});
