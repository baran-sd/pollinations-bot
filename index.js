require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

// Use /data for HuggingFace persistent storage, fallback to local
const HF_DATA_DIR = '/data';
const PROMPTS_FILE = (fs.existsSync(HF_DATA_DIR) ? path.join(HF_DATA_DIR, 'prompts.json') : path.join(__dirname, 'prompts.json'));
console.log(`📁 Prompts file path: ${PROMPTS_FILE}`);

// Default prompts if none exist
const DEFAULT_PROMPTS = [
  { 
    id: 'default', 
    name: '🌟 Standard', 
    text: 'Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: ' 
  },
  { 
    id: 'anime', 
    name: '⛩ Anime Style', 
    text: 'Convert the user request into a detailed anime-style prompt. Mention specific anime aesthetics like Makoto Shinkai lighting or Studio Ghibli vibes. High quality, 4k, vibrant colors. Output ONLY the improved English prompt: ' 
  },
  { 
    id: 'photo', 
    name: '📸 Photorealistic', 
    text: 'Transform the user request into a ultra-realistic photographic prompt. Specify camera (Sony A7R IV), lens (85mm f/1.4), lighting (golden hour), and texture details. Output ONLY the improved English prompt: ' 
  }
];

function loadSavedPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading prompts:', err);
  }
  return { global: DEFAULT_PROMPTS };
}

function saveSavedPrompts(prompts) {
  try {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
  } catch (err) {
    console.error('Error saving prompts:', err);
  }
}

let savedPrompts = loadSavedPrompts();


// БЛОК ОБХОДА DNS БЛОКИРОВКИ ДЛЯ API.TELEGRAM.ORG
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.telegram.org') {
    console.log(`[DNS Hijack] Перенаправляем api.telegram.org -> 149.154.167.220`);
    return callback(null, [{ address: '149.154.167.220', family: 4 }], 4);
  }
  return originalLookup(hostname, options, callback);
};

// Принудительно устанавливаем Google DNS для обхода проблем в Private Space
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  console.log("Установлены сторонние DNS (8.8.8.8)");
} catch (e) {
  console.error("Не удалось сменить DNS сервера:", e.message);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;
const systemEnhancePrompt = process.env.SYSTEM_ENHANCE_PROMPT || `Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: `;

let botError = null;
let bot = null;
let botUserName = 'Unknown';
let networkStatus = 'Инициализация...';
let networkChecks = {
  dns: 'Ожидание...',
  ip_1_1_1_1: 'Ожидание...',
  tg_ip: 'Ожидание...',
  google: 'Ожидание...'
};
let connectionHistory = [];

async function initializeBot() {
  if (!token || !token.includes(':')) {
    botError = "Недействительный токен Telegram-бота. Проверьте переменную TELEGRAM_BOT_TOKEN.";
    console.error("ОШИБКА: " + botError);
    return;
  }

  process.env.NTBA_FIX_350 = 1;
  
  // 1. Ждем немного для стабилизации сети в Docker
  networkStatus = "Стабилизация сети (2 сек)...";
  await new Promise(r => setTimeout(r, 2000));

  // 2. Проверка 1: DNS Google (8.8.8.8)
  try {
    networkChecks.dns = "Проверка...";
    await axios.get('https://8.8.8.8', { timeout: 3000, validateStatus: false });
    networkChecks.dns = "✅ Доступно";
  } catch (e) {
    networkChecks.dns = `❌ ${e.message}`;
  }

  // 3. Проверка 2: Прямой IP (1.1.1.1)
  try {
    networkChecks.ip_1_1_1_1 = "Проверка...";
    await axios.get('https://1.1.1.1', { timeout: 3000, validateStatus: false });
    networkChecks.ip_1_1_1_1 = "✅ Доступно";
  } catch (e) {
    networkChecks.ip_1_1_1_1 = `❌ ${e.message}`;
  }

  // 4. Проверка 3: Telegram IP (149.154.167.220)
  try {
    networkChecks.tg_ip = "Проверка...";
    await axios.get('https://149.154.167.220', { timeout: 3000, validateStatus: false });
    networkChecks.tg_ip = "✅ Доступно (SSL Error expected but route OK)";
  } catch (e) {
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
        networkChecks.tg_ip = `❌ ${e.message}`;
    } else {
        networkChecks.tg_ip = `✅ Доступно (${e.code || 'TLS/SSL Error - Route OK'})`;
    }
  }

  // 5. Проверка 4: Google.com (DNS Check)
  try {
    networkChecks.google = "Проверка...";
    await axios.get('https://www.google.com', { timeout: 3000 });
    networkChecks.google = "✅ Доступно (DNS работает)";
    networkStatus = "Сеть: Доступна (DNS OK)";
  } catch (e) {
    networkChecks.google = `❌ ${e.message}`;
    networkStatus = "Сеть: Проблемы с DNS или блокировка";
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


// Escape HTML special characters to prevent Telegram parse errors
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// State Management
const userSettings = new Map(); // chatId -> { aspectRatio: '...', systemPrompt: '...', state: '...' }
const userHistory = new Map(); // chatId -> { originalPrompt, enhancedPrompt, modelId }

function getSettings(chatId) {
  const settings = userSettings.get(chatId) || { 
    aspectRatio: '1024x1024',
    activePromptId: 'default'
  };
  return settings;
}

// ===== CORE: Функция генерации медиа через Pollinations API =====
async function generateMedia(chatId, callbackQueryId, originalPrompt, preEnhancedPrompt, modelId, referenceImageUrl) {
  const settings = getSettings(chatId);
  const isVideo = ['ltx-2', 'wan', 'wan-fast', 'seedance', 'veo', 'nova-reel', 'p-video', 'grok-video-pro', 'seedance-pro'].includes(modelId);

  try {
    // 1. Отвечаем на callback (если есть)
    if (callbackQueryId) {
      await bot.answerCallbackQuery(callbackQueryId, { text: isVideo ? '🎬 Генерирую видео...' : '🎨 Генерирую изображение...' });
    }

    // 2. Отправляем сообщение "в процессе"
    const statusMsg = await bot.sendMessage(chatId, isVideo
      ? '🎬 Генерирую видео... Это может занять до 2 минут ⏳'
      : '🎨 Улучшаю ваш промпт и генерирую изображение... ⏳');

    // 3. Улучшаем промпт (если нет готового)
    let enhancedPrompt = preEnhancedPrompt;
    if (!enhancedPrompt) {
      try {
        const userPrompts = savedPrompts[chatId] || savedPrompts.global;
        const activePromptObj = userPrompts.find(p => p.id === settings.activePromptId) || userPrompts[0];
        const sysPrompt = activePromptObj ? activePromptObj.text : systemEnhancePrompt;
        
        const enhanceResponse = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
          model: 'openai-fast',
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: originalPrompt }
          ],
          temperature: 0.9,
          seed: -1
        }, {
          headers: {
            'Authorization': `Bearer ${pollinationsKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        enhancedPrompt = enhanceResponse.data?.choices?.[0]?.message?.content?.trim();
        if (!enhancedPrompt) {
          enhancedPrompt = originalPrompt;
        }
        console.log(`✨ Промпт улучшен: "${originalPrompt}" → "${enhancedPrompt}"`);
      } catch (enhanceErr) {
        console.error('⚠️ Ошибка улучшения промпта, используем оригинал:', enhanceErr.message);
        enhancedPrompt = originalPrompt;
      }
    }

    // 4. Сохраняем историю
    userHistory.set(chatId, { originalPrompt, enhancedPrompt, modelId });

    // 5. Обновляем статус (обрезаем до безопасной длины)
    const statusPrompt = escapeHtml(enhancedPrompt.length > 500 ? enhancedPrompt.substring(0, 500) + '...' : enhancedPrompt);
    const statusType = isVideo ? '🎬 Генерирую видео...' : '🎨 Генерирую изображение...';
    await bot.editMessageText(
      `${statusType}\n\n📝 Улучшенный промпт:\n<i>${statusPrompt}</i>`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
    ).catch(() => {
      // Fallback без форматирования
      bot.editMessageText(
        `${statusType}\n\n📝 Улучшенный промпт:\n${enhancedPrompt.substring(0, 500)}`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      ).catch(() => {});
    });

    // 6. Формируем URL для генерации
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const [width, height] = (settings.aspectRatio || '1024x1024').split('x');

    const params = new URLSearchParams();
    params.set('model', modelId);
    params.set('seed', '-1');
    params.set('nologo', 'true');
    if (pollinationsKey) {
      params.set('key', pollinationsKey);
    }

    if (referenceImageUrl) {
      params.set('image', referenceImageUrl);
    }

    if (isVideo) {
      params.set('duration', '5');
      params.set('aspectRatio', parseInt(width) > parseInt(height) ? '16:9' : '9:16');
    } else {
      params.set('width', width);
      params.set('height', height);
    }

    const imageUrl = `https://gen.pollinations.ai/image/${encodedPrompt}?${params.toString()}`;
    console.log(`🌐 Запрос: ${imageUrl}`);

    // 7. Скачиваем результат
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: isVideo ? 180000 : 90000, // 3 мин для видео, 1.5 мин для изображений
      headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {},
      maxRedirects: 5
    });

    const contentType = response.headers['content-type'] || '';
    const buffer = Buffer.from(response.data);

    if (buffer.length < 1000) {
      throw new Error('Получен слишком маленький файл — возможно ошибка API');
    }

    console.log(`✅ Получен ответ: ${contentType}, размер: ${buffer.length} байт`);

    // 8. Удаляем статусное сообщение
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    // 9. Кнопки действий
    const actionKeyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Перегенерировать', callback_data: 'action_regen' },
          { text: '🎬 Сделать видео', callback_data: 'action_video' }
        ]
      ]
    };

    // 10. Отправляем результат — обрезаем промпт ДО обёртки в HTML теги
    const maxPromptLen = 800;
    let displayPrompt = escapeHtml(enhancedPrompt);
    if (displayPrompt.length > maxPromptLen) {
      displayPrompt = displayPrompt.substring(0, maxPromptLen) + '...';
    }
    const caption = `✨ <b>Промпт:</b> <i>${displayPrompt}</i>\n🎨 <b>Модель:</b> ${modelId}\n📐 <b>Размер:</b> ${settings.aspectRatio || '1024x1024'}`;
    
    // Fallback-подход: если HTML не проходит — отправляем без форматирования
    const plainCaption = `✨ Промпт: ${enhancedPrompt.substring(0, maxPromptLen)}${enhancedPrompt.length > maxPromptLen ? '...' : ''}\n🎨 Модель: ${modelId}\n📐 Размер: ${settings.aspectRatio || '1024x1024'}`;

    const sendOptions = { parse_mode: 'HTML', reply_markup: JSON.stringify(actionKeyboard) };
    const sendOptionsFallback = { reply_markup: JSON.stringify(actionKeyboard) };

    try {
      if (isVideo || contentType.includes('video')) {
        await bot.sendVideo(chatId, buffer, {
          caption, ...sendOptions
        }, {
          filename: 'video.mp4',
          contentType: 'video/mp4'
        });
      } else {
        await bot.sendPhoto(chatId, buffer, {
          caption, ...sendOptions
        }, {
          filename: 'image.jpg',
          contentType: contentType || 'image/jpeg'
        });
      }
    } catch (sendErr) {
      console.warn('⚠️ Ошибка отправки с HTML, пробуем без форматирования:', sendErr.message);
      if (isVideo || contentType.includes('video')) {
        await bot.sendVideo(chatId, buffer, {
          caption: plainCaption, ...sendOptionsFallback
        }, {
          filename: 'video.mp4',
          contentType: 'video/mp4'
        });
      } else {
        await bot.sendPhoto(chatId, buffer, {
          caption: plainCaption, ...sendOptionsFallback
        }, {
          filename: 'image.jpg',
          contentType: contentType || 'image/jpeg'
        });
      }
    }

    console.log(`📨 Результат отправлен в чат ${chatId}`);

  } catch (error) {
    console.error(`❌ Ошибка генерации для чата ${chatId}:`, error.message);

    let errorMessage = '❌ Ошибка при генерации.';

    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        errorMessage = '❌ Ошибка авторизации API. Проверьте POLLINATIONS_API_KEY.';
      } else if (status === 402) {
        errorMessage = '❌ Недостаточно баланса на Pollinations. Пополните аккаунт.';
      } else if (status === 429) {
        errorMessage = '❌ Слишком много запросов. Подождите немного и попробуйте снова.';
      } else {
        errorMessage = `❌ Ошибка API (${status}): ${error.response.statusText || 'Unknown'}`;
      }
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = '❌ Таймаут — генерация заняла слишком долго. Попробуйте снова или выберите другую модель.';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = '❌ Не удалось подключиться к Pollinations API. Проблемы с сетью.';
    }

    await bot.sendMessage(chatId, `${errorMessage}\n\n🔧 Детали: ${escapeHtml(error.message)}`);
  }
}

function setupBotHandlers() {
  if (setupBotHandlers.done) return;
  setupBotHandlers.done = true;

  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const uptime = Math.floor(process.uptime());
    const statusInfo = `🚀 <b>Статус бота:</b>
✅ Работает (online)
🕒 Аптайм: ${uptime} сек.
📡 Сборка: ${process.env.NODE_ENV || 'development'}
📍 Инстанс: ${process.env.HOSTNAME || 'Local/HF-Space'}`;
    bot.sendMessage(chatId, statusInfo, { parse_mode: 'HTML' });
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 Привет! Я мощный ИИ-бот.

Что я умею:
1️⃣ Генерировать **картинки** по тексту (Я всегда сам улучшаю ваши промпты!)
2️⃣ Редактировать **твои фото** (Отправь фото с подписью, что изменить)
3️⃣ Делать **видео** из текста или картинок

🛠 Настройки: /settings
📋 Список промптов: /prompts`;
    bot.sendMessage(chatId, welcomeMessage);
  });

  bot.onText(/\/prompts/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    const userPrompts = savedPrompts[chatId] || savedPrompts.global;
    
    let keyboard = [];
    userPrompts.forEach(p => {
      const isSelected = p.id === settings.activePromptId;
      keyboard.push([{ 
        text: `${isSelected ? '✅ ' : ''}${p.name}`, 
        callback_data: `p_select_${p.id}` 
      }, {
        text: '🗑',
        callback_data: `p_del_${p.id}`
      }]);
    });
    keyboard.push([{ text: '➕ Добавить новый', callback_data: 'p_add' }]);

    bot.sendMessage(chatId, '🗂 <b>Ваши системные промпты</b>\nВыберите активный промпт или создайте новый:', { 
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/prompt/, (msg) => {
    bot.sendMessage(msg.chat.id, "Команда /prompt теперь заменена на /prompts для управления списком промптов.");
  });

  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    if (settings.state) {
      settings.state = null;
      settings.tempNewPromptName = null;
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
    const settings = getSettings(chatId);
    
    // БЛОК 1: Обработка Мастера создания промптов (ВЫСШИЙ ПРИОРИТЕТ)
    if (settings.state === 'waiting_for_new_prompt_name' && userInput && !userInput.startsWith('/')) {
      console.log(`[Wizard] Получено название: "${userInput}" для чата ${chatId}`);
      settings.tempNewPromptName = userInput;
      settings.state = 'waiting_for_new_prompt_text';
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `Принято название: <b>${escapeHtml(userInput)}</b>\n\nТеперь отправьте сам текст системного промпта (инструкции для ИИ):`, { parse_mode: 'HTML' });
    }

    if (settings.state === 'waiting_for_new_prompt_text' && userInput && !userInput.startsWith('/')) {
      console.log(`[Wizard] Получен текст промпта для "${settings.tempNewPromptName}"`);
      const newPrompt = {
        id: 'p_' + Date.now(),
        name: settings.tempNewPromptName,
        text: userInput
      };
      
      if (!savedPrompts[chatId]) {
        savedPrompts[chatId] = [...(savedPrompts.global || DEFAULT_PROMPTS)];
      }
      savedPrompts[chatId].push(newPrompt);
      saveSavedPrompts(savedPrompts);

      settings.state = null;
      settings.tempNewPromptName = null;
      settings.activePromptId = newPrompt.id;
      userSettings.set(chatId, settings);
      
      return bot.sendMessage(chatId, `✅ Промпт <b>${escapeHtml(newPrompt.name)}</b> успешно сохранен и выбран как основной!`, { parse_mode: 'HTML' });
    }

    // Если это команда — пропускаем (они обрабатываются в других местах)
    if (userInput && userInput.startsWith('/')) return;

    if (userInput) {
        console.log(`📩 Сообщение от @${msg.from.username || 'unknown'} [${chatId}]: "${userInput}"`);
    }

    // Обработка Фото
    if (msg.photo) {
      const captionText = msg.caption || 'Make it look better and more high quality';
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const fileLink = await bot.getFileLink(photoId); 
        await generateMedia(chatId, null, captionText, null, 'klein', fileLink); 
      } catch (err) {
        bot.sendMessage(chatId, "❌ Ошибка получения картинки.");
      }
      return;
    }

    if (!userInput) return;

    // ОБЫЧНАЯ ГЕНЕРАЦИЯ
    userHistory.set(chatId, { originalPrompt: userInput });
    
    const modelKeyboard = {
      inline_keyboard: [[
        { text: '🌟 Z-Image Turbo', callback_data: 'model_zimage' },
        { text: '⚡ Flux Schnell', callback_data: 'model_flux' },
        { text: '💎 Flux Klein', callback_data: 'model_klein' }
      ]]
    };

    await bot.sendMessage(chatId, `Отличная идея:\n"${userInput}"\n\nВыберите модель:`, {
      reply_markup: JSON.stringify(modelKeyboard)
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
  
    if (data.startsWith('p_select_')) {
      const promptId = data.replace('p_select_', '');
      const settings = getSettings(chatId);
      settings.activePromptId = promptId;
      userSettings.set(chatId, settings);
      
      const userPrompts = savedPrompts[chatId] || savedPrompts.global;
      const prompt = userPrompts.find(p => p.id === promptId);
      
      bot.answerCallbackQuery(query.id, { text: `Активен: ${prompt ? prompt.name : promptId}` });
      
      // Обновляем список, чтобы показать галочку
      let keyboard = [];
      userPrompts.forEach(p => {
        const isSelected = p.id === settings.activePromptId;
        keyboard.push([{ 
          text: `${isSelected ? '✅ ' : ''}${p.name}`, 
          callback_data: `p_select_${p.id}` 
        }, {
          text: '🗑',
          callback_data: `p_del_${p.id}`
        }]);
      });
      keyboard.push([{ text: '➕ Добавить новый', callback_data: 'p_add' }]);
      
      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    if (data.startsWith('p_del_')) {
      const promptId = data.replace('p_del_', '');
      if (promptId === 'default') return bot.answerCallbackQuery(query.id, { text: 'Нельзя удалить стандартный промпт', show_alert: true });
      
      if (!savedPrompts[chatId]) {
        savedPrompts[chatId] = [...(savedPrompts.global || DEFAULT_PROMPTS)];
      }
      
      savedPrompts[chatId] = savedPrompts[chatId].filter(p => p.id !== promptId);
      saveSavedPrompts(savedPrompts);
      
      const settings = getSettings(chatId);
      if (settings.activePromptId === promptId) settings.activePromptId = 'default';
      userSettings.set(chatId, settings);
      
      bot.answerCallbackQuery(query.id, { text: 'Удалено' });
      
      // Обновляем список
      const userPrompts = savedPrompts[chatId];
      let keyboard = [];
      userPrompts.forEach(p => {
        const isSelected = p.id === settings.activePromptId;
        keyboard.push([{ 
          text: `${isSelected ? '✅ ' : ''}${p.name}`, 
          callback_data: `p_select_${p.id}` 
        }, {
          text: '🗑',
          callback_data: `p_del_${p.id}`
        }]);
      });
      keyboard.push([{ text: '➕ Добавить новый', callback_data: 'p_add' }]);
      
      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    if (data === 'p_add') {
      const settings = getSettings(chatId);
      settings.state = 'waiting_for_new_prompt_name';
      userSettings.set(chatId, settings);
      bot.sendMessage(chatId, '📝 Введите название для вашего нового системного промпта:');
      bot.answerCallbackQuery(query.id);
      return;
    }

    // --- Original Handlers ---
    if (data.startsWith('ar_')) {
      const ar = data.split('_')[1];
      console.log(`⚙️ Смена формата (ChatID: ${chatId}) на: ${ar}`);
      const settings = getSettings(chatId);
      settings.aspectRatio = ar;
      userSettings.set(chatId, settings);
      bot.editMessageText(`✅ Формат изменен на ${ar}\nВсе новые картинки будут создаваться в этом размере.`, { chat_id: chatId, message_id: query.message.message_id });
      bot.answerCallbackQuery(query.id);
      return;
    }
  
    if (data.startsWith('model_')) {
      const modelId = data.substring('model_'.length);
      const history = userHistory.get(chatId);
      if (!history) return bot.answerCallbackQuery(query.id, { text: 'Сессия устарела', show_alert: true });
      
      bot.editMessageText(`Выбрана модель: <b>${modelId}</b>`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML' });
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

  const diagHtml = `
    <div style="background: #eee; padding: 10px; margin: 10px 0; font-family: monospace; font-size: 0.9em; text-align: left;">
        <b>Диагностика (Обновите страницу через 15 сек):</b><br>
        - DNS Google (8.8.8.8): ${networkChecks.dns}<br>
        - IP Cloudflare (1.1.1.1): ${networkChecks.ip_1_1_1_1}<br>
        - IP Telegram (149.154.167.220): ${networkChecks.tg_ip}<br>
        - Host Google.com (DNS Test): ${networkChecks.google}
    </div>
  `;

  if (botError) {
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: auto;">
        <h1 style="color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">❌ Проблема с запуском</h1>
        <div style="background: #fdf2f2; border-left: 5px solid #e74c3c; padding: 15px; margin: 20px 0;">
            <strong>Статус сети:</strong> ${networkStatus}<br>
            <strong>Текущая ошибка:</strong> ${botError}
        </div>
        ${diagHtml}
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
            ${diagHtml}
            <p>Статус: <b>Online</b> | Uptime: ${Math.floor(process.uptime())} сек.</p>
        </div>
        <a href="https://t.me/${botUserName}" target="_blank" style="display: inline-block; background: #0088cc; color: white; padding: 10px 25px; border-radius: 50px; text-decoration: none; font-weight: bold;">➡️ Открыть в Telegram</a>
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">Hugging Face Space Deployment (Private)</p>
      </div>
    `);
  }
});
app.listen(process.env.PORT || 7860, '0.0.0.0', () => console.log('Облачный сервер запущен на 7860'));
