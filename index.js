require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;
const systemEnhancePrompt = process.env.SYSTEM_ENHANCE_PROMPT || `Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: `;

if (!token || !token.includes(':')) {
  console.error("ТЕКСТОВАЯ ОШИБКА: Недействительный токен Telegram-бота.");
  process.exit(1);
}

process.env.NTBA_FIX_350 = 1;
const bot = new TelegramBot(token, { polling: true });

console.log("--- БОТ ЗАПУСКАЕТСЯ ---");
console.log("Интервал поллинга: активен");

// State Management
const userSettings = new Map(); // chatId -> { aspectRatio: '...', systemPrompt: '...', state: '...' }
const userHistory = new Map(); // chatId -> { originalPrompt, enhancedPrompt, modelId }

function getSettings(chatId) {
  return userSettings.get(chatId) || { aspectRatio: '1024x1024' };
}

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

// Main generator core structure
async function generateMedia(chatId, queryId, originalPrompt, providedEnhanced = null, forceModel = null, imageToEditUrl = null) {
  const settings = getSettings(chatId);
  const statusMsg = await bot.sendMessage(chatId, '⚙️ Работаю над запросом...');
  
  try {
    const config = pollinationsKey ? { headers: { 'Authorization': `Bearer ${pollinationsKey}` } } : {};
    let enhancedPrompt = providedEnhanced;

    // Сначала улучшаем промпт, если он ещё не улучшен
    if (!enhancedPrompt) {
      const activeSystemPrompt = settings.systemPrompt || systemEnhancePrompt;
      const textResponse = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
        model: "openai",
        messages: [{ role: "user", content: activeSystemPrompt + originalPrompt }]
      }, config);
      enhancedPrompt = textResponse.data.choices[0].message.content;

      await bot.editMessageText('🎨 Генерирую медиа по промпту...\n\n_Промпт: ' + enhancedPrompt + '_', {
        chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown'
      });
    }

    const seed = Math.floor(Math.random() * 100000);
    const useModel = forceModel || 'flux'; 

    if (useModel === 'ltx-2') {
      // 1. Video generation
      await bot.editMessageText('🎥 Генерирую видео (это может занять около 1 минуты)...', {
        chat_id: chatId, message_id: statusMsg.message_id
      });
      const videoResponse = await axios.post('https://gen.pollinations.ai/v1/images/generations', {
        prompt: enhancedPrompt,
        model: 'ltx-2',
        response_format: "url", 
        seed: seed
      }, config);
      
      const videoUrl = videoResponse.data.data[0].url;
      await bot.sendVideo(chatId, videoUrl, {
        caption: `✨ Видео готово!\n**Запрос:** ${originalPrompt}`
      });

    } else if (imageToEditUrl) {
      // 2. Image to Image Edit
      const editResponse = await axios.post('https://gen.pollinations.ai/v1/images/edits', {
        prompt: enhancedPrompt,
        image: imageToEditUrl,
        model: useModel,
        response_format: "b64_json",
        seed: seed
      }, config);

      const b64Json = editResponse.data.data[0].b64_json;
      const imageBuffer = Buffer.from(b64Json, 'base64');
      await saveHistoryAndSendPhoto(chatId, originalPrompt, enhancedPrompt, useModel, imageBuffer);

    } else {
      // 3. Normal Image generation
      const imageResponse = await axios.post('https://gen.pollinations.ai/v1/images/generations', {
        prompt: enhancedPrompt,
        model: useModel,
        size: settings.aspectRatio,
        response_format: "b64_json",
        seed: seed
      }, config);

      const b64Json = imageResponse.data.data[0].b64_json;
      const imageBuffer = Buffer.from(b64Json, 'base64');
      await saveHistoryAndSendPhoto(chatId, originalPrompt, enhancedPrompt, useModel, imageBuffer);
    }

    await bot.deleteMessage(chatId, statusMsg.message_id);

  } catch (error) {
    const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`❌ ОШИБКА ГЕНЕРАЦИИ (ChatID: ${chatId}):`, errorDetail);
    
    let userFriendlyError = '❌ Ошибка генерации. Возможно, сервера перегружены.';
    if (errorDetail.includes('invalid_api_key')) {
        userFriendlyError = '❌ Ошибка: Неверный API-ключ Pollinations.';
    }
    
    bot.sendMessage(chatId, userFriendlyError);
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>null);
  } finally {
    if (queryId) bot.answerCallbackQuery(queryId);
  }
}

async function saveHistoryAndSendPhoto(chatId, originalPrompt, enhancedPrompt, modelId, imageBuffer) {
  userHistory.set(chatId, { originalPrompt, enhancedPrompt, modelId });

  let captionText = `✨ Готово!\nМодель: #${modelId}\n\n**Запрос:** ${originalPrompt}\n**Промпт:** ${enhancedPrompt}`;
  if (captionText.length > 1000) captionText = captionText.substring(0, 1000) + '...';

  const keyboard = {
    inline_keyboard: [
      [
        { text: '♻️ Перегенерировать', callback_data: 'action_regen' },
        { text: '🎥 Оживить (Видео)', callback_data: 'action_video' }
      ]
    ]
  };

  await bot.sendPhoto(chatId, imageBuffer, {
    caption: captionText,
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify(keyboard)
  });
}

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

const app = express();
app.get('/', (req, res) => res.send('Бот запущен и работает!'));
app.listen(process.env.PORT || 7860, () => console.log('Облачный сервер запущен на 7860'));
