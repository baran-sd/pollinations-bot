require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;
const systemEnhancePrompt = process.env.SYSTEM_ENHANCE_PROMPT || `Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: `;

let botError = null;
let bot = null;
let botUserName = 'Unknown';
let networkStatus = 'Ожидание запуска...';
let connectionHistory = [];

async function initializeBot() {
  if (!token || !token.includes(':')) {
    botError = "Недействительный токен Telegram-бота. Проверьте переменную TELEGRAM_BOT_TOKEN.";
    console.error("ОШИБКА: " + botError);
    return;
  }

  process.env.NTBA_FIX_350 = 1;
  
  // 1. Ждем немного для стабилизации сети в Docker
  networkStatus = "Стабилизация сети (5 сек)...";
  await new Promise(r => setTimeout(r, 5000));

  // 2. Проверка общего интернета
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    networkStatus = "✅ Интернет доступен (HTTP OK)";
  } catch (e) {
    networkStatus = `⚠️ Ограниченная связь: ${e.message}`;
    console.warn(networkStatus);
  }

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    const timestamp = new Date().toLocaleTimeString();
    try {
      console.log(`[${timestamp}] Попытка подключения #${attempts}...`);
      
      // Инициализируем бота только один раз
      if (!bot) {
        bot = new TelegramBot(token, { polling: true });
        // Вешаем слушатели ошибок один раз
        bot.on('polling_error', (error) => {
          console.error(`[Polling Error] ${error.code}: ${error.message}`);
          if (error.message.includes('409 Conflict')) {
            botError = "Конфликт: Бот запущен в другом месте. Выключите локального бота!";
          }
        });
      }

      const user = await bot.getMe();
      botUserName = user.username;
      botError = null;
      console.log(`✅ Бот @${botUserName} успешно авторизован.`);
      setupBotHandlers(); // Установка обработчиков сообщений
      return; 

    } catch (err) {
      const errorMsg = `${err.code || 'ERROR'}: ${err.message}`;
      connectionHistory.push(`[${timestamp}] Попытка ${attempts}: ${errorMsg}`);
      console.error(`❌ Попытка ${attempts} не удалась: ${errorMsg}`);
      botError = `Ошибка подключения: ${errorMsg}`;

      if (attempts < maxAttempts && (err.message.includes('ENOTFOUND') || err.message.includes('EFATAL') || err.message.includes('ETIMEDOUT'))) {
        const waitTime = 10000;
        networkStatus = `🔄 Ошибка сети. Повтор через ${waitTime/1000}с...`;
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        break;
      }
    }
  }
}

initializeBot();


// State Management
const userSettings = new Map(); // chatId -> { aspectRatio: '...', systemPrompt: '...', state: '...' }
const userHistory = new Map(); // chatId -> { originalPrompt, enhancedPrompt, modelId }

function getSettings(chatId) {
  return userSettings.get(chatId) || { aspectRatio: '1024x1024' };
}

function setupBotHandlers() {
  if (setupBotHandlers.done) return;
  setupBotHandlers.done = true;

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
  const historyHtml = connectionHistory.length > 0 
    ? `<h3>История попыток:</h3><ul>${connectionHistory.map(line => `<li>${line}</li>`).join('')}</ul>` 
    : '';

  if (botError) {
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: auto;">
        <h1 style="color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">❌ Проблема с запуском</h1>
        <div style="background: #fdf2f2; border-left: 5px solid #e74c3c; padding: 15px; margin: 20px 0;">
            <strong>Статус сети:</strong> ${networkStatus}<br>
            <strong>Текущая ошибка:</strong> ${botError}
        </div>
        ${historyHtml}
        <hr>
        <h3>🛠 Что делать?</h3>
        <ol>
            <li>Если ошибка <b>"ENOTFOUND"</b> или <b>"EFATAL"</b> в <b>Private Space</b> — это значит, что Space не может «увидеть» интернет. Попробуйте перезапустить Space (Restart) или проверьте, не включены ли в настройках HF ограничения Egress.</li>
            <li>Убедитесь, что <code>TELEGRAM_BOT_TOKEN</code> в настройках верный.</li>
            <li>Если ошибка <b>"Conflict 409"</b> — выключите бота на компьютере.</li>
        </ol>
        <p style="color: #666; font-size: 0.9em; margin-top: 20px;">Instance: ${process.env.HOSTNAME || 'Local'}</p>
      </div>
    `);
  } else {
    res.send(`
      <div style="font-family: sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: auto; text-align: center;">
        <h1 style="color: #27ae60;">✅ Бот "@${botUserName}" запущен!</h1>
        <div style="background: #f1f8f4; padding: 20px; border-radius: 10px; border: 1px solid #d4edda; margin: 20px 0;">
            <p style="font-size: 1.2em; color: #155724;"><strong>Параметры сети:</strong> ${networkStatus}</p>
            <p>Статус: <b>Online</b> | Uptime: ${Math.floor(process.uptime())} сек.</p>
        </div>
        <a href="https://t.me/${botUserName}" target="_blank" style="display: inline-block; background: #0088cc; color: white; padding: 10px 25px; border-radius: 50px; text-decoration: none; font-weight: bold;">➡️ Открыть в Telegram</a>
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">Hugging Face Space Deployment (Private)</p>
      </div>
    `);
  }
});
app.listen(process.env.PORT || 7860, '0.0.0.0', () => console.log('Облачный сервер запущен на 7860'));
