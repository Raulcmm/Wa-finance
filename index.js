require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const app = express();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_APP_URL = process.env.RENDER_APP_URL;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN no definido');
  process.exit(1);
}

if (!RENDER_APP_URL) {
  console.error('Error: RENDER_APP_URL no definido');
  process.exit(1);
}

// Inicia bot sin polling, usaremos webhook
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Conecta MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', expenseSchema);

app.use(express.json());

// Configura webhook
const webHookUrl = `${RENDER_APP_URL}/bot${TELEGRAM_BOT_TOKEN}`;
bot.setWebHook(webHookUrl)
  .then(() => console.log(`Webhook configurado en: ${webHookUrl}`))
  .catch(err => console.error('Error configurando webhook:', err.message));

app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/ping', (req, res) => {
  res.send('✅ Bot activo');
});

// Función para enviar gráfico
async function sendChart(chatId, bot, summary) {
  const chartConfig = {
    type: 'bar',
    data: {
      labels: Object.keys(summary),
      datasets: [{
        label: 'Gastos por categoría',
        data: Object.values(summary),
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      }],
    },
    options: {
      scales: {
        y: { beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  };

  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

  try {
    await bot.sendPhoto(chatId, chartUrl, { caption: '📊 Resumen gráfico de tus gastos' });
  } catch (error) {
    console.error('Error enviando gráfico:', error);
    await bot.sendMessage(chatId, '❌ No pude enviar el gráfico esta vez. Intenta más tarde.');
  }
}

// Manejador mensajes
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const incomingMsg = (msg.text || '').toLowerCase().trim();

  try {
    if (incomingMsg.startsWith('gasto')) {
      const expenseRegex = /^gasto\s+(\d+(\.\d{1,2})?)\s+(.+)$/;
      const match = incomingMsg.match(expenseRegex);
      if (match) {
        const amount = parseFloat(match[1]);
        const category = match[3].trim();
        const newExpense = new Expense({ amount, category });
        await newExpense.save();
        await bot.sendMessage(chatId, `✅ Gasto de *$${amount.toFixed(2)}* en "${category}" registrado.`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, 'Formato inválido. Usa: gasto [cantidad] [categoría]');
      }

    } else if (incomingMsg === 'resumen') {
      const expenses = await Expense.find({});
      if (expenses.length === 0) {
        await bot.sendMessage(chatId, 'Aún no tienes gastos registrados.');
      } else {
        const summary = {};
        expenses.forEach(e => {
          const cat = e.category.toLowerCase();
          summary[cat] = (summary[cat] || 0) + e.amount;
        });

        let summaryMessage = '📊 *Resumen de tus gastos:*\n';
        for (const [cat, total] of Object.entries(summary)) {
          summaryMessage += `• ${cat.charAt(0).toUpperCase() + cat.slice(1)}: *$${total.toFixed(2)}*\n`;
        }
        const total = expenses.reduce((sum, e) => sum + e.amount, 0);
        summaryMessage += `\n*Total Gasto: $${total.toFixed(2)}*`;

        await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
        await sendChart(chatId, bot, summary);
      }

    } else {
      await bot.sendMessage(chatId,
        '👋 ¡Hola! Soy tu bot de finanzas.\n\n' +
        'Usa:\n' +
        '* "gasto [cantidad] [categoría]" para registrar un gasto (ej. gasto 100 comida)\n' +
        '* "resumen" para ver tus gastos y gráfico.',
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    await bot.sendMessage(chatId, '❌ Ocurrió un error. Intenta más tarde.');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});
