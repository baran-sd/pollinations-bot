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
console.log(`ℹ️ Prompts file path: ${PROMPTS_FILE}`);

const CADAVRE_PROMPT = `## ROLE
You are Cadavre Exquis Prompt Generator. Create prompts for AI image generation in the "Exquisite Corpse" style — surreal portraits where the character's body is divided into 3-5 style zones, seamlessly flowing into each other like a gradient.

## PROMPT STRUCTURE
Each prompt MUST contain these blocks in a single line without breaks:
1. OPENING — image type + character + key unity condition
2. POSE — character's pose
3. ZONE DIVISION — explanation of the division principle
4. ZONE A (TOP) — style of head and chest
5. ZONE B (MIDDLE) — torso style
6. ZONE C (BOTTOM) — legs style
7. UNITY CLAUSE — critical requirement for anatomical integrity
8. BACKGROUND — background/atmosphere
9. TECHNICAL — quality, lighting, resolution

## TEMPLATE
A stunning full-body portrait of a single [GENDER/AGE], ONE CONSISTENT CHARACTER throughout the entire image. [POSE DESCRIPTION]. Their body is divided into THREE SEAMLESS STYLE ZONES that flow into each other like a gradient: TOP (head to chest): [STYLE A] aesthetic - [details of head, hair, makeup, jewelry, skin elements]. MIDDLE (chest to hips): [STYLE B] aesthetic - same person's torso shows [details of clothing, armor, textures, glowing elements]. BOTTOM (hips to feet): [STYLE C] aesthetic - same person's legs feature [details of skirt/pants, shoes, accessories on legs]. CRITICAL: identical facial features throughout, same skin tone, same body proportions, continuous anatomy. Only the SURFACE STYLE changes, not the person. Background: [description of background]. Dramatic cinematic lighting, vertical portrait, photorealistic quality, 8k resolution.

## RULES
1. SINGLE LINE — no line breaks, everything through spaces and periods.
2. CONSISTENCY — repeat "same person" in each zone.
3. TRANSITIONS — use "flow into each other like a gradient".
4. DETAIL — minimum 5-7 specific elements per zone.
5. COLOR PALETTE — if specified, indicate "COLOR PALETTE: [colors] only".

## STYLE BANK
Punk styles: Cyberpunk, Steampunk, Solarpunk, Biopunk, Dieselpunk, Atompunk, Clockpunk, Mythpunk, Magicpunk, Cryocore, Darkwave.
Eras: Prehistoric, Ancient Egyptian, Medieval, Renaissance, Victorian, Art Deco, 1950s Retro, Y2K, Y3K Future.
Aesthetics: Ethereal, Goth, Rave, Cottagecore, Darkcore, Fairycore, Cyber Goth, Vaporwave, Witchcore.

## POSES
- Standing confidently, facing forward
- Dynamic dancing pose, arms raised
- Standing with back to camera, looking over shoulder
- Walking as on runway, mid-stride
- Crouching in dynamic dance move
- Spinning with motion blur effect
- Hands on hips, powerful stance

## BACKGROUNDS
- Electrical storm with lightning and rain
- Industrial forges with flames and embers
- Ice cave with aurora borealis and lasers
- Neon-lit cyberpunk cityscape
- Ancient temple ruins with magical glow
- Underwater bioluminescent cave
- Cosmic void with nebulae and stars

Output ONLY the raw English prompt for the following user request: `;

const DEFAULT_PROMPTS = [
  { 
    id: 'cadavre', 
    name: '💀 Cadavre Exquis', 
    text: CADAVRE_PROMPT
  },
  { 
    id: 'default', 
    name: '✨ Standard', 
    text: 'Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: ' 
  },
  { 
    id: 'anime', 
    name: '🌸 Anime Style', 
    text: 'Convert the user request into a detailed anime-style prompt. Mention specific anime aesthetics like Makoto Shinkai lighting or Studio Ghibli vibes. High quality, 4k, vibrant colors. Output ONLY the improved English prompt: ' 
  },
  { 
    id: 'photo', 
    name: '📸 Photorealistic', 
    text: 'Transform the user request into a ultra-realistic photographic prompt. Specify camera (Sony A7R IV), lens (85mm f/1.4), lighting (golden hour), and texture details. Output ONLY the improved English prompt: ' 
  },
  {
    id: 'video-pro',
    name: '🎬 Video Expert',
    text: `You are an expert AI video prompt engineer. You receive a brief description of a desired video scene (in any language) and output a single, production-ready English video prompt.

## OUTPUT FORMAT
Return ONLY the final prompt text. No explanations, no labels, no markdown.

## PROMPT STRUCTURE
1. SHOT TYPE & FRAMING
2. CAMERA MOVEMENT + SPEED
3. SUBJECT + ACTION
4. ENVIRONMENT & SETTING
5. LIGHTING
6. LENS & DEPTH OF FIELD
7. STYLE & TEXTURE
8. AUDIO DIRECTION
9. QUALITY ANCHORS: smooth, steady, cinematic, professional quality, no jitter, constant speed`
  }
];

function getGlobalPrompts(localPrompts = []) {
  const all = [...DEFAULT_PROMPTS];
  if (localPrompts && Array.isArray(localPrompts)) {
    localPrompts.forEach(p => {
      if (!all.find(dp => dp.id === p.id)) all.push(p);
    });
  }
  if (airtablePromptsCache.length > 0) {
    airtablePromptsCache.forEach(p => {
      if (!all.find(dp => dp.id === p.id)) all.push(p);
    });
  }
  return all;
}

function loadSavedPrompts() {
  let prompts = { global: [] };
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
      prompts = JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading prompts:', err);
  }
  prompts.global = getGlobalPrompts(prompts.global);
  return prompts;
}

function saveSavedPrompts(prompts) {
  try {
    const promptsToSave = JSON.parse(JSON.stringify(prompts));
    for (const key in promptsToSave) {
      promptsToSave[key] = promptsToSave[key].filter(p => !p.id.startsWith('at_'));
    }
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(promptsToSave, null, 2));
  } catch (err) {
    console.error('Error saving prompts:', err);
  }
}

// DNS Hijack for Telegram API
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.telegram.org') {
    console.log('[DNS Hijack] Redirecting api.telegram.org -> 149.154.167.220');
    return callback(null, [{ address: '149.154.167.220', family: 4 }], 4);
  }
  return originalLookup(hostname, options, callback);
};

try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.error("DNS update failed:", e.message);
}

let airtablePromptsCache = [];
async function syncAirtable() {
  const token_key = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
  let baseId = (process.env.AIRTABLE_BASE_ID || '').trim();
  const tableName = (process.env.AIRTABLE_TABLE_NAME || 'Prompts').trim();
  const match = baseId.match(/(app[a-zA-Z0-9]+)/);
  if (match) baseId = match[1];
  if (!token_key || !baseId) return;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  try {
    const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${token_key}` } });
    if (response.data && response.data.records) {
      airtablePromptsCache = response.data.records.map(r => ({
        id: `at_${r.id}`,
        name: `⭐ ${r.fields.Name || 'Unnamed'}`,
        text: r.fields.SystemPrompt || ''
      })).filter(p => p.text);
      console.log(`✅ Airtable synced: ${airtablePromptsCache.length} prompts loaded.`);
    }
  } catch (err) {
    console.error('❌ Airtable Sync Error:', err.message);
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;
const systemEnhancePrompt = process.env.SYSTEM_ENHANCE_PROMPT || `Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: `;

let bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  console.error(`[Polling Error] ${error.code}: ${error.message}`);
});

async function init() {
  try {
    const me = await bot.getMe();
    console.log(`Bot @${me.username} is up.`);
    setupBotHandlers();
  } catch (e) {
    console.error('Init error:', e);
  }
}

init();

setInterval(syncAirtable, 600000); 
setTimeout(syncAirtable, 2000);

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const userSettings = new Map();
const userHistory = new Map();

const MODELS = {
  text: [
    { id: 'openai', name: 'OpenAI GPT-4o' },
    { id: 'openai-fast', name: 'OpenAI GPT-4o-mini' },
    { id: 'deepseek', name: 'DeepSeek V3' },
    { id: 'grok', name: 'xAI Grok' },
    { id: 'gemini-fast', name: 'Gemini 1.5 Flash' },
    { id: 'mistral-large', name: 'Mistral Large' },
    { id: 'claude-fast', name: 'Claude 3 Haiku' }
  ],
  image: [
    { id: 'flux', name: 'Flux.1 Schnell' },
    { id: 'flux-realism', name: 'Flux Realism' },
    { id: 'flux-anime', name: 'Flux Anime' },
    { id: 'any-dark', name: 'Any Dark' }
  ],
  video: [
    { id: 'ltx-2', name: 'LTX-2' },
    { id: 'nova-reel', name: 'Amazon Nova Reel' }
  ],
  audio: [
    { id: 'elevenlabs', name: 'ElevenLabs TTS' },
    { id: 'elevenmusic', name: 'ElevenLabs Music' }
  ]
};

function getSettings(chatId) {
  let settings = userSettings.get(chatId);
  if (!settings) {
    settings = { 
      aspectRatio: '1024x1024',
      activePromptId: 'cadavre',
      format: 'webp',
      defaultMode: 'ask',
      defaults: {
        text: 'openai-fast',
        image: 'flux',
        video: 'ltx-2',
        audio: 'elevenlabs'
      }
    };
    userSettings.set(chatId, settings);
  }
  return settings;
}

// ===== CORE GENERATION =====
async function generateMedia(chatId, callbackQueryId, originalPrompt, preEnhancedPrompt, modelId, category, referenceImageUrl) {
  const settings = getSettings(chatId);
  const isVideo = category === 'video' || ['ltx-2', 'nova-reel', 'wan', 'wan-fast'].includes(modelId);
  const isAudio = category === 'audio' || ['elevenlabs', 'elevenmusic', 'acestep', 'scribe'].includes(modelId);
  const isText = category === 'text' || MODELS.text.some(m => m.id === modelId);

  try {
    const waitMsg = isVideo ? '🎬 Генерирую видео...' : (isAudio ? '🎵 Генерирую аудио...' : (isText ? '✍️ Думаю...' : '🎨 Рисую...'));
    const statusMsg = await bot.sendMessage(chatId, waitMsg);

    if (isText) {
      const response = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
        model: modelId,
        messages: [{ role: 'user', content: originalPrompt }],
        temperature: 0.7
      }, {
        headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {},
        timeout: 60000
      });

      const content = response.data?.choices?.[0]?.message?.content;
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      if (!content) throw new Error('Ошибка: не удалось получить ответ от нейросети');
      
      await bot.sendMessage(chatId, `✍️ <b>Ответ (${modelId}):</b>\n\n${escapeHtml(content)}`, { parse_mode: 'HTML' });
      return;
    }

    // --- 2. Prompt Enhancement ---
    let enhancedPrompt = preEnhancedPrompt;
    if (!enhancedPrompt && !isAudio) {
      try {
        const allPrompts = loadSavedPrompts();
        const userPrompts = allPrompts[chatId] || allPrompts.global;
        const activePromptObj = userPrompts.find(p => p.id === settings.activePromptId) || userPrompts[0];
        const sysPrompt = activePromptObj ? activePromptObj.text : (process.env.SYSTEM_ENHANCE_PROMPT || systemEnhancePrompt);
        
        const enhanceResponse = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
          model: settings.defaults.text || 'openai-fast',
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: originalPrompt }
          ],
          temperature: 0.9
        }, {
          headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {},
          timeout: 40000
        });

        enhancedPrompt = enhanceResponse.data?.choices?.[0]?.message?.content?.trim();
      } catch (err) {
        console.warn('Enhancement failed, using original:', err.message);
        enhancedPrompt = originalPrompt;
      }
    }
    if (!enhancedPrompt) enhancedPrompt = originalPrompt;

    // --- 3. URL Generation ---
    const params = new URLSearchParams();
    params.set('model', modelId);
    if (pollinationsKey) params.set('key', pollinationsKey);

    let apiUrl = '';
    if (isAudio) {
      apiUrl = `https://gen.pollinations.ai/audio/${encodeURIComponent(originalPrompt)}?${params.toString()}`;
    } else if (isVideo) {
      params.set('duration', '5');
      const [w, h] = (settings.aspectRatio || '1024x1024').split('x');
      params.set('aspectRatio', parseInt(w) > parseInt(h) ? '16:9' : '9:16');
      if (referenceImageUrl) params.set('image', referenceImageUrl);
      params.set('seed', '-1');
      params.set('nologo', 'true');
      apiUrl = `https://gen.pollinations.ai/video/${encodeURIComponent(enhancedPrompt)}?${params.toString()}`;
    } else {
      const [w, h] = (settings.aspectRatio || '1024x1024').split('x');
      params.set('width', w);
      params.set('height', h);
      if (referenceImageUrl) params.set('image', referenceImageUrl);
      params.set('seed', '-1');
      params.set('nologo', 'true');
      params.set('format', settings.format || 'webp');
      apiUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(enhancedPrompt)}?${params.toString()}`;
    }

    console.log(`🌐 API Request: ${apiUrl}`);

    const response = await axios.get(apiUrl, {
      responseType: 'arraybuffer',
      timeout: isVideo ? 180000 : 90000,
      headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {}
    });

    const buffer = Buffer.from(response.data);
    if (buffer.length < 500) throw new Error('Response too small');

    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    // --- 4. Sending Result ---
    const actionKeyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Перегенерировать', callback_data: `action_regen` },
          category === 'image' ? { text: '🎬 Сделать видео', callback_data: 'action_image_to_video' } : null
        ].filter(Boolean)
      ]
    };

    const caption = isAudio ? `🎵 <b>Запрос:</b> ${originalPrompt}\n🤖 <b>Модель:</b> ${modelId}` :
                   `✨ <b>Промпт:</b> <i>${escapeHtml(enhancedPrompt.substring(0, 500))}</i>\n🤖 <b>Модель:</b> ${modelId}`;

    const sendOps = { caption, parse_mode: 'HTML', reply_markup: JSON.stringify(actionKeyboard) };
    userHistory.set(chatId, { originalPrompt, enhancedPrompt, modelId, category, referenceImageUrl });

    if (isAudio) {
      await bot.sendAudio(chatId, buffer, { caption, ...sendOps });
    } else if (isVideo) {
      await bot.sendVideo(chatId, buffer, sendOps);
    } else {
      const sentMsg = await bot.sendPhoto(chatId, buffer, sendOps);
      const history = userHistory.get(chatId);
      if (sentMsg.photo && sentMsg.photo.length > 0) {
        const photoId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
        try {
          const fileLink = await bot.getFileLink(photoId);
          history.lastImageUrl = fileLink;
        } catch (e) {
          history.lastImageUrl = apiUrl;
        }
      } else {
        history.lastImageUrl = apiUrl;
      }
      userHistory.set(chatId, history);
    }
  } catch (error) {
    console.error('Generation Error:', error.message);
    await bot.sendMessage(chatId, `❌ Ошибка генерации: ${escapeHtml(error.message)}`);
  }
}

function setupBotHandlers() {
  if (setupBotHandlers.done) return;
  setupBotHandlers.done = true;

  bot.onText(/\/sync/, async (msg) => {
    bot.sendMessage(msg.chat.id, "🔄 Синхронизация с Airtable...");
    await syncAirtable();
    bot.sendMessage(msg.chat.id, `✅ Готово! Загружено ${airtablePromptsCache.length} промптов.`);
  });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "👋 Привет! Я бот для генерации контента через Pollinations.AI.\n\n/settings - Настройки\n/prompts - Системные промпты");
  });

  bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    const keyboard = {
      inline_keyboard: [
        [{ text: `📐 Соотношение: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
        [{ text: `🖼 Формат: ${settings.format}`, callback_data: 'settings_format' }],
        [{ text: `🤖 Режим: ${settings.defaultMode}`, callback_data: 'settings_mode' }]
      ]
    };
    bot.sendMessage(chatId, '⚙️ <b>Настройки бота</b>', { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.onText(/\/prompts/, async (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    
    if (airtablePromptsCache.length === 0) {
      return bot.sendMessage(chatId, "⚠️ Список промптов пуст. Используйте /sync для загрузки из Airtable.");
    }

    const keyboard = {
      inline_keyboard: airtablePromptsCache.map(p => [{ text: p.name, callback_data: `selectprompt_${p.name}` }])
    };
    
    bot.sendMessage(chatId, "📝 <b>Выберите системный промпт:</b>\n\nТекущий: <i>" + (settings.systemPromptName || 'По умолчанию') + "</i>", { 
      parse_mode: 'HTML', 
      reply_markup: keyboard 
    });
  });

  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    settings.state = null;
    userSettings.set(chatId, settings);
    bot.sendMessage(chatId, "❌ Действие отменено.");
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('selectprompt_')) {
      const promptName = data.replace('selectprompt_', '');
      const settings = getSettings(chatId);
      settings.systemPromptName = promptName;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Выбран промпт: ${promptName}` });
      bot.editMessageText(`✅ Теперь используется промпт: <b>${promptName}</b>`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'settings_back') {
      const settings = getSettings(chatId);
      const keyboard = {
        inline_keyboard: [
          [{ text: `📐 Соотношение: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `🖼 Формат: ${settings.format}`, callback_data: 'settings_format' }],
          [{ text: `🤖 Режим: ${settings.defaultMode}`, callback_data: 'settings_mode' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройки бота</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'action_regen') {
      const history = userHistory.get(chatId);
      if (!history) return bot.answerCallbackQuery(query.id, { text: "История пуста" });
      bot.answerCallbackQuery(query.id, { text: "Перегенерация..." });
      return generateMedia(chatId, query.id, history.originalPrompt, null, history.modelId, history.category, history.referenceImageUrl);
    }

    if (data === 'settings_ar') {
      const ars = ['1024x1024', '16:9', '9:16', '3:2', '2:3'];
      const keyboard = {
        inline_keyboard: ars.map(ar => [{ text: ar, callback_data: `setar_${ar}` }])
      };
      keyboard.inline_keyboard.push([{ text: '⬅️ Назад', callback_data: 'settings_back' }]);
      bot.editMessageText('Выберите соотношение сторон:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: keyboard });
      return;
    }

    if (data.startsWith('setar_')) {
      const ar = data.replace('setar_', '');
      const settings = getSettings(chatId);
      settings.aspectRatio = ar;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Установлено: ${ar}` });
      return;
    }

    bot.answerCallbackQuery(query.id);
  });

  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);

    if (settings.state === 'waiting_for_prompt_name') {
      settings.tempPromptName = msg.text;
      settings.state = 'waiting_for_prompt_text';
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `Имя: ${msg.text}\nТеперь введите текст промпта:`);
    }

    if (settings.state === 'waiting_for_prompt_text') {
      const newPrompt = { name: settings.tempPromptName, prompt: msg.text };
      airtablePromptsCache.push(newPrompt);
      settings.state = null;
      settings.systemPromptName = newPrompt.name;
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `✅ Промпт "${newPrompt.name}" сохранен и выбран!`);
    }

    // Default generation
    const model = settings.defaultMode === 'video' ? settings.defaults.video : settings.defaults.image;
    const category = settings.defaultMode === 'video' ? 'video' : 'image';
    
    generateMedia(chatId, null, msg.text, null, model, category);
  });
}

const app = express();
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; padding: 30px; text-align: center;">
      <h1 style="color: #27ae60;">Бот @${process.env.BOT_NAME || 'Bot'} активен!</h1>
      <p>Статус: <b>Online</b></p>
      <a href="https://t.me/${process.env.BOT_NAME || ''}" style="color: #0088cc;">Открыть в Telegram</a>
    </div>
  `);
});

app.listen(process.env.PORT || 7860, '0.0.0.0', () => console.log('Web server running on 7860'));