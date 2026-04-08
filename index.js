require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;
const systemEnhancePrompt = process.env.SYSTEM_ENHANCE_PROMPT || `Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: `;

let botError = null;
let bot = null;

if (!token || !token.includes(':')) {
  botError = "❌ Недействительный токен Telegram-бота. Добавьте TELEGRAM_BOT_TOKEN в Variables and secrets на Hugging Face.";
  console.error("ОШИБКА: " + botError);
} else {
  process.env.NTBA_FIX_350 = 1;
  bot = new TelegramBot(token, { polling: true });
  console.log("--- БОТ ЗАПУСКАЕТСЯ ---");
  console.log("Интервал поллинга: активен");
}

// State Management
const userSettings = new Map(); // chatId -> { aspectRatio: '...', systemPrompt: '...', state: '...' }
const userHistory = new Map(); // chatId -> { originalPrompt, enhancedPrompt, modelId }

function getSettings(chatId) {
  return userSettings.get(chatId) || { aspectRatio: '1024x1024' };
}

if (bot) {
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const uptime = Math.floor(process.uptime());
    const statusInfo = `🚀 **Статус бота:**
✅ Работает (online)
🕒 Аптайм: ${uptime} сек.
📡 Сборка: ${process.env.NODE_ENV || 'development'}
📍 Инстанс: ${process.env.HOSTNAME || 'Local/HF-Space'}`;
    bot.sendMessage(chatId, statusInfo, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 Привет! Я мощный ИИ-бот.

Что я умею:
1️⃣ Генерировать **картинки** по тексту (Я всегда сам улучшаю ваши промпты!)
2️⃣ Редактировать **твои фото** (Отправь фото с подписью, что изменить)
3️⃣ Делать **видео** из текста или картинок

🛠 Настройки: /settings
✏️ Изменить ИИ-промпт: /prompt`;
    bot.sendMessage(chatId, welcomeMessage);
  });

  bot.onText(/\/prompt/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    settings.state = 'waiting_for_prompt';
    userSettings.set(chatId, settings);
    
    const current = settings.systemPrompt || systemEnhancePrompt;
    bot.sendMessage(chatId, `Текущий системный промпт:\n_\`\`\`\n${current}\n\`\`\`_\n\nОтправьте мне новый системный промпт для ваших улучшений (например: "Переведи запрос на английский, добавь стиль аниме и яркие краски").\nИли напишите /cancel для отмены.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    if (settings.state) {
      settings.state = null;
      userSettings.set(chatId, settings);
      bot.sendMessage(chatId, 'Действие отменено.');
    }
  });

  bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔲 Квадрат (1024x1024)', callback_data: 'ar_1024x1024' }],
        [{ text: '📱 Вертикальный (768x1024)', callback_data: 'ar_768x1024' }],
        [{ text: '💻 Горизонтальный (1024x768)', callback_data: 'ar_1024x768' }]
      ]
    };
    bot.sendMessage(chatId, '⚙️ Выберите формат генерируемых изображений по умолчанию:', { reply_markup: JSON.stringify(keyboard) });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userInput = msg.text;
    
    if (userInput) {
        console.log(`📩 Новое сообщение от @${msg.from.username || 'unknown'} [${chatId}]: "${userInput}"`);
    }

    // Handle waiting for prompt state
    const settings = getSettings(chatId);
    if (settings.state === 'waiting_for_prompt' && userInput && !userInput.startsWith('/')) {
      settings.systemPrompt = userInput;
      settings.state = null;
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, '✅ Персональный системный промпт обновлен! Теперь генерируйте картинки как обычно.');
    }

    // Если прислали фото
    if (msg.photo) {
      const caption = msg.caption || 'Make it look better and more high quality';
      const photoId = msg.photo[msg.photo.length - 1].file_id; // берем лучшее качество
      try {
        const fileLink = await bot.getFileLink(photoId); 
        // Запускаем переработку фото
        await generateMedia(chatId, null, caption, null, 'flux-klein', fileLink); 
      } catch (err) {
        bot.sendMessage(chatId, "❌ Ошибка получения картинки от Telegram.");
      }
      return;
    }

    if (!userInput || userInput.startsWith('/')) return;

    // Обычный текст: спрашиваем модель
    userHistory.set(chatId, { originalPrompt: userInput }); // Временно храним ввод

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🌟 Z-Image Turbo', callback_data: 'model_zimage' },
          { text: '⚡ Flux Schnell', callback_data: 'model_flux' },
          { text: '💎 Flux Klein', callback_data: 'model_flux-klein' }
        ]
      ]
    };

    await bot.sendMessage(chatId, `Отличная идея:\n"${userInput}"\n\nВыберите модель:`, {
      reply_markup: JSON.stringify(keyboard)
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
  
    if (data.startsWith('ar_')) {
      const ar = data.split('_')[1];
      console.log(`⚙️ Смена формата (ChatID: ${chatId}) на: ${ar}`);
      userSettings.set(chatId, { aspectRatio: ar });
      bot.editMessageText(`✅ Формат изменен на ${ar}\nВсе новые картинки будут создаваться в этом размере.`, { chat_id: chatId, message_id: query.message.message_id });
      bot.answerCallbackQuery(query.id);
      return;
    }
  
    if (data.startsWith('model_')) {
      const modelId = data.split('_')[1];
      const history = userHistory.get(chatId);
      if (!history) return bot.answerCallbackQuery(query.id, { text: 'Сессия устарела', show_alert: true });
      
      bot.editMessageText(`Выбрана модель: **${modelId}**`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      generateMedia(chatId, query.id, history.originalPrompt, null, modelId, null);
      return;
    }
  
    if (data === 'action_regen') {
      const history = userHistory.get(chatId);
      if (!history || !history.enhancedPrompt) return bot.answerCallbackQuery(query.id, { text: 'Нет истории для перегенерации', show_alert: true });
      generateMedia(chatId, query.id, history.originalPrompt, history.enhancedPrompt, history.modelId, null);
      return;
    }
  
    if (data === 'action_video') {
      const history = userHistory.get(chatId);
      if (!history || !history.enhancedPrompt) return bot.answerCallbackQuery(query.id, { text: 'Нет истории', show_alert: true });
      generateMedia(chatId, query.id, history.originalPrompt, history.enhancedPrompt, 'ltx-2', null);
      return;
    }
  });
}

const app = express();
app.get('/', (req, res) => {
  if (botError) {
    res.status(500).send(`<h1>Ошибка работы бота</h1><p style="color: red;">${botError}</p>`);
  } else {
    res.send('<h1>Бот запущен и работает успешно!</h1><p>Слушаем сообщения Telegram.</p>');
  }
});
app.listen(process.env.PORT || 7860, '0.0.0.0', () => console.log('Облачный сервер запущен на 7860'));
