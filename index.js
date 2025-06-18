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