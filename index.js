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

let airtablePromptsCache = [];
let lastUpdateId = 0;
let isPolling = false;

async function startAxiosPolling(bot, token) {
  if (isPolling) return;
  isPolling = true;
  console.log("🚀 Custom Axios Polling Started...");

  while (isPolling) {
    try {
      const response = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 30, // Long polling
          allowed_updates: ["message", "callback_query"]
        },
        timeout: 40000, // Slightly longer than TG timeout
        httpsAgent: new (require('https')).Agent({ keepAlive: true, family: 4 })
      });

      if (response.data && response.data.ok) {
        const updates = response.data.result;
        for (const update of updates) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
          // Process update via the bot's internal engine
          bot.processUpdate(update);
        }
      }
    } catch (err) {
      // Don't log normal timeout errors
      if (err.code !== 'ECONNABORTED' && !err.message.includes('timeout')) {
        console.error(`[Axios Polling Error] ${err.message}`);
        // If it's a real network error, wait a bit longer
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    // Small pause to prevent tight loops in case of empty ok response
    await new Promise(r => setTimeout(r, 100));
  }
}



async function syncAirtable() {
  let token_key = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
  let baseId = (process.env.AIRTABLE_BASE_ID || '').trim();
  let tableName = (process.env.AIRTABLE_TABLE_NAME || 'Prompts').trim();
  
  // Extract only the Base ID (app...) in case user pasted a full URL or appended the Table ID (tbl...)
  const match = baseId.match(/(app[a-zA-Z0-9]+)/);
  if (match) {
    baseId = match[1];
  }

  if (!token_key || !baseId) return;

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  
  try {
    const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${token_key}` } });
    
    if (response.data && response.data.records) {
      airtablePromptsCache = response.data.records.map(r => ({
        id: `at_${r.id}`,
        name: `☁️ ${r.fields.Name || 'Unnamed'}`,
        text: r.fields.SystemPrompt || ''
      })).filter(p => p.text);
      console.log(`✅ Airtable synced: ${airtablePromptsCache.length} prompts loaded.`);
    }
  } catch (err) {
    if (err.response) {
      console.error(`❌ Airtable Sync Error: URL: https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
      console.error(`❌ Airtable Response: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('❌ Airtable Sync Error:', err.message);
    }
  }
}
setInterval(syncAirtable, 5 * 60 * 1000);

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

// Default prompts if none exist
const DEFAULT_PROMPTS = [
  { 
    id: 'cadavre', 
    name: '💀 Cadavre Exquis', 
    text: CADAVRE_PROMPT
  },
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
  },
  {
    id: 'video-pro',
    name: '🎬 Video Expert',
    text: `You are an expert AI video prompt engineer. You receive a brief description of a desired video scene (in any language) and output a single, production-ready English video prompt.

## OUTPUT FORMAT
Return ONLY the final prompt text. No explanations, no labels, no markdown.

## PROMPT STRUCTURE (always follow this order)
1. SHOT TYPE & FRAMING: extreme close-up / close-up / medium / wide / establishing / POV / top-down / low angle / high angle / Dutch angle
2. CAMERA MOVEMENT + SPEED: specify exact move (dolly, pan, tilt, track, orbit, boom, crane, whip pan, crash zoom, Steadicam float, handheld vérité, static) + speed (glacially slow / slow / moderate / fast / whip-speed) + direction
3. SUBJECT + ACTION: who/what is in frame, what they are doing, body language, expression, clothing, key details
4. ENVIRONMENT & SETTING: location, time of day, weather, production design details, background elements
5. LIGHTING: key light direction, color temperature, contrast ratio, practical lights, motivated sources, shadows
6. LENS & DEPTH OF FIELD: focal length (24mm wide / 35mm / 50mm / 85mm portrait / 135mm telephoto), aperture feel (shallow bokeh f/1.4 vs deep focus f/11), anamorphic or spherical
7. STYLE & TEXTURE: film stock feel, grain, color grade, visual reference (decade, genre, director style — no real names)
8. AUDIO DIRECTION: ambient sound, SFX, dialogue (with tone/emotion in parentheses), music presence or absence — always specify "no music" if unwanted
9. QUALITY ANCHORS: always append — smooth, steady, cinematic, professional quality, no jitter, constant speed

## RULES
- Every prompt must be SELF-CONTAINED: no pronouns referencing other scenes, no "same as before"
- Prompt length: 60–150 words. Dense but readable.
- Default duration assumption: 5 seconds. If user specifies duration, adjust action density accordingly.
- For TRANSITIONS (user mentions "from A to B" or "переход"): describe START state → transformation style → END state → camera behavior during transition
- For DIALOGUE: write speech in natural sentence case, never ALL CAPS. Add tone: (whispered), (excited), (deadpan). Keep lines under 5 seconds of speech.
- NEVER include: real celebrity names, copyrighted characters, brand names, slurs
- If the scene is unclear or too vague, make bold creative choices — do NOT ask questions
- Specify "no people visible" for empty environments, "no music, ambient only" when needed
- Add physics/weight cues for realism: "heavy footsteps pressing into wet sand", "fabric billowing with real weight"
- Prevent AI artifacts: add "maintains rigid shape" for objects, "no morphing" for faces, "constant lighting" to prevent flicker`
  }
];

function getGlobalPrompts() {
  if (airtablePromptsCache.length > 0) {
    return [...DEFAULT_PROMPTS, ...airtablePromptsCache];
  }
  return DEFAULT_PROMPTS;
}

function loadSavedPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.global) parsed.global = getGlobalPrompts();
      return parsed;
    }
  } catch (err) {
    console.error('Error loading prompts:', err);
  }
  return { global: getGlobalPrompts() };
}

function saveSavedPrompts(prompts) {
  try {
    // Не сохраняем облачные промпты в локальный файл
    const promptsToSave = JSON.parse(JSON.stringify(prompts));
    for (const key in promptsToSave) {
      promptsToSave[key] = promptsToSave[key].filter(p => !p.id.startsWith('at_'));
    }
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(promptsToSave, null, 2));
  } catch (err) {
    console.error('Error saving prompts:', err);
  }
}


// БЛОК ОБХОДА DNS БЛОКИРОВКИ ДЛЯ API.TELEGRAM.ORG
// const originalLookup = dns.lookup;
// dns.lookup = (hostname, options, callback) => {
//   if (typeof options === 'function') {
//     callback = options;
//     options = {};
//   }
//   if (hostname === 'api.telegram.org') {
//     console.log(`[DNS Hijack] Перенаправляем api.telegram.org -> 149.154.167.220`);
//     return callback(null, [{ address: '149.154.167.220', family: 4 }], 4);
//   }
//   return originalLookup(hostname, options, callback);
// };

// DNS settings - only use if specified, otherwise rely on environment
if (process.env.USE_GOOGLE_DNS === 'true') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
    console.log("🛠 Using Google DNS (8.8.8.8)");
  } catch (e) {
    console.warn("⚠️ Could not set custom DNS:", e.message);
  }
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
      
      if (!bot) {
        bot = new TelegramBot(token, { 
          polling: false, // Disable native polling completely
          request: {
            agentOptions: {
              keepAlive: true,
              family: 4
            }
          }
        });

        // We can still keep the error handler for other request errors
        bot.on('error', (error) => {
          console.error(`[Bot Error] ${error.message}`);
        });
      }

      const user = await bot.getMe();
      botUserName = user.username;
      botError = null;
      console.log(`✅ Бот @${botUserName} успешно авторизован.`);
      
      setupBotHandlers(); // Установка обработчиков сообщений
      
      // Start our custom high-resilience polling
      startAxiosPolling(bot, token);
      
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
setTimeout(syncAirtable, 3000); // Запуск Airtable парсера после старта


// Escape HTML special characters to prevent Telegram parse errors
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// State Management
const userSettings = new Map(); // chatId -> { aspectRatio: '...', activePromptId: '...', state: '...', defaults: {} }
const userHistory = new Map(); // chatId -> { originalPrompt, enhancedPrompt, modelId, lastImageUrl, category }

// Model Definitions (Free models based on Pollinations API docs)
const MODELS = {
  text: [
    { id: 'openai', name: 'OpenAI GPT-5.4 Nano' },
    { id: 'openai-fast', name: 'OpenAI GPT-5 Nano (Fast)' },
    { id: 'deepseek', name: 'DeepSeek V3' },
    { id: 'grok', name: 'xAI Grok 4.1' },
    { id: 'gemini-fast', name: 'Google Gemini 2.5 Flash' },
    { id: 'mistral-large', name: 'Mistral Large 3' },
    { id: 'qwen-large', name: 'Qwen 3.5 Plus' },
    { id: 'claude-fast', name: 'Anthropic Claude Haiku 4.5' },
    { id: 'perplexity-fast', name: 'Perplexity Sonar' },
    { id: 'kimi', name: 'Moonshot Kimi K2' },
    { id: 'nova', name: 'Amazon Nova 2' },
    { id: 'glm', name: 'Z.ai GLM-5' },
    { id: 'minimax', name: 'MiniMax M2.5' },
    { id: 'polly', name: 'Polly Assistant' }
  ],
  image: [
    { id: 'flux', name: 'Flux.1 Schnell' },
    { id: 'flux-realism', name: 'Flux Realism' },
    { id: 'flux-anime', name: 'Flux Anime' },
    { id: 'flux-3d', name: 'Flux 3D' },
    { id: 'flux-pro', name: 'Flux.1 Pro (Key Required)' },
    { id: 'any-dark', name: 'Any Dark' },
    { id: 'zimage', name: 'Z-Image Turbo' },
    { id: 'klein', name: 'Flux Klein' }
  ],
  video: [
    { id: 'ltx-2', name: 'LTX-2.3 (Fast)' },
    { id: 'nova-reel', name: 'Amazon Nova Reel' }
  ],
  audio: [
    { id: 'elevenlabs', name: 'ElevenLabs TTS' },
    { id: 'elevenmusic', name: 'ElevenLabs Music' },
    { id: 'acestep', name: 'ACE-Step Music' },
    { id: 'scribe', name: 'ElevenLabs Scribe' }
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

// ===== CORE: Универсальная функция генерации (Text, Image, Video, Audio) =====
async function generateMedia(chatId, callbackQueryId, originalPrompt, preEnhancedPrompt, modelId, category, referenceImageUrl) {
  const settings = getSettings(chatId);
  const isVideo = category === 'video' || ['ltx-2', 'nova-reel', 'wan', 'wan-fast'].includes(modelId);
  const isAudio = category === 'audio' || ['elevenlabs', 'elevenmusic', 'acestep', 'scribe'].includes(modelId);
  const isText = category === 'text' || MODELS.text.some(m => m.id === modelId);

  try {
    if (callbackQueryId) {
      const respText = isVideo ? '🎬 Генерирую видео...' : (isAudio ? '🎵 Генерирую аудио...' : (isText ? '💬 Генерирую ответ...' : '🎨 Генерирую изображение...'));
      await bot.answerCallbackQuery(callbackQueryId, { text: respText });
    }

    const waitMsg = isVideo ? '🎬 Генерирую видео... (до 2 мин) ⏳' : 
                   (isAudio ? '🎵 Генерирую аудио... ⏳' : 
                   (isText ? '💬 Думаю над ответом... ⏳' : 
                   '🎨 Улучшаю промпт и рисую... ⏳'));
    const statusMsg = await bot.sendMessage(chatId, waitMsg);

    // --- 1. Текстовая генерация (LLM) ---
    if (isText) {
      const response = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
        model: modelId,
        messages: [{ role: 'user', content: originalPrompt }],
        temperature: 0.7,
        seed: -1
      }, {
        headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {},
        timeout: 60000
      });

      const content = response.data?.choices?.[0]?.message?.content;
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      if (!content) throw new Error('Пустой ответ от модели');
      
      await bot.sendMessage(chatId, `💬 <b>Ответ (${modelId}):</b>\n\n${escapeHtml(content)}`, { parse_mode: 'HTML' });
      return;
    }

    // --- 2. Улучшение промпта (только для картинок и видео) ---
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
          temperature: 0.9,
          seed: -1
        }, {
          headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {},
          timeout: 40000
        });

        enhancedPrompt = enhanceResponse.data?.choices?.[0]?.message?.content?.trim();
      } catch (err) {
        console.warn('⚠️ Ошибка улучшения:', err.message);
        enhancedPrompt = originalPrompt;
      }
    }
    if (!enhancedPrompt) enhancedPrompt = originalPrompt;

    // --- 3. Формирование URL для Медиа (Image, Video, Audio) ---
    const params = new URLSearchParams();
    params.set('model', modelId);
    if (pollinationsKey) params.set('key', pollinationsKey);

    let apiUrl = '';
    if (isAudio) {
      if (modelId === 'elevenlabs') params.set('voice', 'nova');
      apiUrl = `https://gen.pollinations.ai/audio/${encodeURIComponent(originalPrompt)}?${params.toString()}`;
    } else if (isVideo) {
      params.set('duration', '5');
      const [w, h] = (settings.aspectRatio || '1024x1024').split('x');
      params.set('aspectRatio', parseInt(w) > parseInt(h) ? '16:9' : '9:16');
      if (referenceImageUrl) params.set('image', referenceImageUrl);
      params.set('seed', '-1');
      params.set('nologo', 'true');
      if (pollinationsKey) params.set('private', 'true'); // Hide from public gallery
      apiUrl = `https://gen.pollinations.ai/video/${encodeURIComponent(enhancedPrompt)}?${params.toString()}`;
    } else {
      const [w, h] = (settings.aspectRatio || '1024x1024').split('x');
      params.set('width', w);
      params.set('height', h);
      if (referenceImageUrl) params.set('image', referenceImageUrl);
      params.set('seed', '-1');
      params.set('nologo', 'true');
      params.set('format', settings.format || 'webp');
      if (pollinationsKey) params.set('private', 'true'); // Hide from public gallery
      apiUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(enhancedPrompt)}?${params.toString()}`;
    }

    console.log(`🌐 API Request: ${apiUrl}`);

    const response = await axios.get(apiUrl, {
      responseType: 'arraybuffer',
      timeout: isVideo ? 180000 : 90000,
      headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {}
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || '';
    if (buffer.length < 500) throw new Error('Response too small - possible error');

    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    // --- 4. Отправка результата ---
    const actionKeyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Снова', callback_data: `action_regen` },
          category === 'image' ? { text: '🎬 Сделать Видео', callback_data: 'action_image_to_video' } : null
        ].filter(Boolean)
      ]
    };

    const caption = isAudio ? `🎵 <b>Аудио:</b> ${originalPrompt}\n🤖 <b>Модель:</b> ${modelId}` :
                   `✨ <b>Промпт:</b> <i>${escapeHtml(enhancedPrompt.substring(0, 500))}</i>\n🎨 <b>Модель:</b> ${modelId}`;

    const sendOps = { caption, parse_mode: 'HTML', reply_markup: JSON.stringify(actionKeyboard) };

    // Сохраняем историю для возможности перегенерации
    userHistory.set(chatId, { originalPrompt, enhancedPrompt, modelId, category, referenceImageUrl });

    if (isAudio) {
      await bot.sendAudio(chatId, buffer, { caption, ...sendOps }, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    } else if (isVideo) {
      await bot.sendVideo(chatId, buffer, sendOps, { filename: 'video.mp4', contentType: 'video/mp4' });
    } else {
      // Отправляем фото и получаем статичную ссылку для Image-to-Video
      const sentMsg = await bot.sendPhoto(chatId, buffer, sendOps);
      
      const history = userHistory.get(chatId);
      if (sentMsg.photo && sentMsg.photo.length > 0) {
        const photoId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
        try {
          const fileLink = await bot.getFileLink(photoId);
          history.lastImageUrl = fileLink;
        } catch (e) {
          console.error("Ошибка при получении file_link:", e.message);
          history.lastImageUrl = apiUrl; // Fallback
        }
      } else {
        history.lastImageUrl = apiUrl;
      }
      userHistory.set(chatId, history);
    }

  } catch (error) {
    console.error('❌ Generation Error:', error.message);
    await bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(error.message)}`);
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
📍 Инстанс: ${process.env.HOSTNAME || 'Local/HF-Space'}
☁️ Airtable Промптов: ${airtablePromptsCache.length}`;
    bot.sendMessage(chatId, statusInfo, { parse_mode: 'HTML' });
  });

  bot.onText(/\/sync/, async (msg) => {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN) {
      return bot.sendMessage(msg.chat.id, "❌ Ошибка: В настройках не указан токен Airtable (`AIRTABLE_PERSONAL_ACCESS_TOKEN`)", { parse_mode: 'Markdown' });
    }
    bot.sendMessage(msg.chat.id, "🔄 Синхронизирую с Airtable...");
    await syncAirtable();
    bot.sendMessage(msg.chat.id, `✅ Успешно! Загружено ${airtablePromptsCache.length} промптов из облака.`);
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
    const allPrompts = loadSavedPrompts();
    const userPrompts = allPrompts[chatId] || allPrompts.global;
    
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
    const settings = getSettings(chatId);
    const keyboard = {
      inline_keyboard: [
        [{ text: `📐 Формат: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
        [{ text: `🖼 Тип файла: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
        [{ text: `⚡️ Режим: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
        [{ text: `🤖 Модели по-умолчанию`, callback_data: 'settings_defaults' }]
      ]
    };
    bot.sendMessage(chatId, '⚙️ <b>Настройки бота</b>\nВыберите параметр для изменения:', { parse_mode: 'HTML', reply_markup: JSON.stringify(keyboard) });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userInput = msg.text;
    const settings = getSettings(chatId);
    
    // БЛОК 1: Обработка Мастера создания промптов (ВЫСШИЙ ПРИОРИТЕТ)
    if (settings.state === 'waiting_for_new_prompt_name' && userInput && !userInput.startsWith('/')) {
      settings.tempNewPromptName = userInput;
      settings.state = 'waiting_for_new_prompt_text';
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `Принято название: <b>${escapeHtml(userInput)}</b>\n\nТеперь отправьте сам текст системного промпта:`, { parse_mode: 'HTML' });
    }

    if (settings.state === 'waiting_for_new_prompt_text' && userInput && !userInput.startsWith('/')) {
      const newPrompt = { id: 'p_' + Date.now(), name: settings.tempNewPromptName, text: userInput };
      const allPrompts = loadSavedPrompts();
      if (!allPrompts[chatId]) allPrompts[chatId] = [...(allPrompts.global || getGlobalPrompts())];
      allPrompts[chatId].push(newPrompt);
      saveSavedPrompts(allPrompts);
      settings.state = null;
      settings.tempNewPromptName = null;
      settings.activePromptId = newPrompt.id;
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `✅ Промпт <b>${escapeHtml(newPrompt.name)}</b> сохранен!`, { parse_mode: 'HTML' });
    }

    if (settings.state === 'waiting_for_video_prompt' && userInput && !userInput.startsWith('/')) {
      const history = userHistory.get(chatId);
      settings.state = null;
      userSettings.set(chatId, settings);
      if (!history || !history.lastImageUrl) return bot.sendMessage(chatId, "❌ Ошибка: базовое изображение потеряно.");
      return generateMedia(chatId, null, userInput, null, settings.defaults.video, 'video', history.lastImageUrl);
    }

    if (userInput && userInput.startsWith('/')) return;

    if (userInput) {
      console.log(`📩 Prompt from @${msg.from.username || 'unknown'}: "${userInput}"`);
      userHistory.set(chatId, { originalPrompt: userInput });

      // Если установлен режим по умолчанию (не "ask"), запускаем генерацию сразу
      if (settings.defaultMode && settings.defaultMode !== 'ask') {
        const category = settings.defaultMode;
        const modelId = settings.defaults[category];
        return generateMedia(chatId, null, userInput, null, modelId, category, null);
      }

      const categoryKeyboard = {
        inline_keyboard: [[
          { text: '🎨 Картинка', callback_data: 'cat_image' },
          { text: '🎬 Видео', callback_data: 'cat_video' }
        ], [
          { text: '🎵 Аудио', callback_data: 'cat_audio' },
          { text: '💬 Текст', callback_data: 'cat_text' }
        ]]
      };

      await bot.sendMessage(chatId, `Что создаем для промпта:\n"${userInput}"?`, {
        reply_markup: JSON.stringify(categoryKeyboard)
      });
    }

    // Обработка Фото (для редактирования)
    if (msg.photo && !userInput) {
      const captionText = msg.caption || 'Make it look better and more high quality';
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const fileLink = await bot.getFileLink(photoId); 
        await generateMedia(chatId, null, captionText, null, 'klein', 'image', fileLink); 
      } catch (err) {
        bot.sendMessage(chatId, "❌ Ошибка получения картинки.");
      }
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
  
    if (data.startsWith('p_select_')) {
      const promptId = data.replace('p_select_', '');
      const settings = getSettings(chatId);
      settings.activePromptId = promptId;
      userSettings.set(chatId, settings);
      
      const allPrompts = loadSavedPrompts();
      const userPrompts = allPrompts[chatId] || allPrompts.global;
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
      if (promptId.startsWith('at_')) return bot.answerCallbackQuery(query.id, { text: 'Этот промпт управляется через Airtable', show_alert: true });
      
      const allPrompts = loadSavedPrompts();
      if (!allPrompts[chatId]) {
        allPrompts[chatId] = [...(allPrompts.global || getGlobalPrompts())];
      }
      
      allPrompts[chatId] = allPrompts[chatId].filter(p => p.id !== promptId);
      saveSavedPrompts(allPrompts);
      
      const settings = getSettings(chatId);
      if (settings.activePromptId === promptId) settings.activePromptId = 'default';
      userSettings.set(chatId, settings);
      
      bot.answerCallbackQuery(query.id, { text: 'Удалено' });
      
      // Обновляем список
      const userPrompts = allPrompts[chatId];
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

    if (data.startsWith('cat_')) {
      const category = data.replace('cat_', '');
      const history = userHistory.get(chatId);
      const settings = getSettings(chatId);
      const defaultModel = settings.defaults[category];
      
      bot.editMessageText(`Выбрана категория: <b>${category}</b>. Использую модель по умолчанию: <b>${defaultModel}</b>.`, {
        chat_id: chatId, 
        message_id: query.message.message_id, 
        parse_mode: 'HTML'
      });
      
      generateMedia(chatId, query.id, history.originalPrompt, null, defaultModel, category, null);
      return;
    }

    if (data === 'action_image_to_video') {
      const history = userHistory.get(chatId);
      if (!history || !history.lastImageUrl) return bot.answerCallbackQuery(query.id, { text: 'Ошибка: картинка не найдена', show_alert: true });
      
      const settings = getSettings(chatId);
      settings.state = 'waiting_for_video_prompt';
      userSettings.set(chatId, settings);
      
      bot.sendMessage(chatId, "🎬 <b>Режим создания видео из картинки</b>\nОпишите, что должно произойти на видео (движение, эффекты):", { parse_mode: 'HTML' });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'action_regen') {
      const history = userHistory.get(chatId);
      if (!history) return bot.answerCallbackQuery(query.id, { text: 'Нет истории', show_alert: true });
      generateMedia(chatId, query.id, history.originalPrompt, history.enhancedPrompt, history.modelId, history.category, history.lastImageUrl);
      return;
    }

    // --- Settings Logic ---
    if (data === 'settings_ar') {
      const settings = getSettings(chatId);
      const arList = [
        { text: '🔲 1:1 (1024x1024)', id: '1024x1024' },
        { text: '📱 3:4 (768x1024)', id: '768x1024' },
        { text: '💻 4:3 (1024x768)', id: '1024x768' }
      ];
      const keyboard = {
        inline_keyboard: arList.map(ar => [{ 
          text: `${settings.aspectRatio === ar.id ? '✅ ' : ''}${ar.text}`, 
          callback_data: `ar_${ar.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_back' }]);
      bot.editMessageText('📐 Выберите формат изображений:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('ar_')) {
      const aspectRatio = data.replace('ar_', '');
      const settings = getSettings(chatId);
      settings.aspectRatio = aspectRatio;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Сохранен формат: ${aspectRatio}` });
      
      const keyboard = {
        inline_keyboard: [
          [{ text: `📐 Формат: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `🤖 Модели по-умолчанию`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройки бота</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_llm' || data === 'settings_defaults') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Default Text', callback_data: 'setdef_text' }],
          [{ text: '🎨 Default Image', callback_data: 'setdef_image' }],
          [{ text: '🎬 Default Video', callback_data: 'setdef_video' }],
          [{ text: '🎵 Default Audio', callback_data: 'setdef_audio' }],
          [{ text: '🔙 Назад', callback_data: 'settings_back' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройка моделей по умолчанию</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('setdef_')) {
      const cat = data.replace('setdef_', '');
      const models = MODELS[cat];
      const settings = getSettings(chatId);
      const currentDef = settings.defaults[cat];
      
      const keyboard = {
        inline_keyboard: models.map(m => [{ 
          text: `${currentDef === m.id ? '✅ ' : ''}${m.name}`, 
          callback_data: `save_def_${cat}_${m.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_defaults' }]);
      bot.editMessageText(`Выберите модель по умолчанию для <b>${cat}</b>:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('save_def_')) {
      const parts = data.split('_');
      const cat = parts[2];
      const modelId = parts[3];
      const settings = getSettings(chatId);
      settings.defaults[cat] = modelId;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Сохранено: ${modelId}` });
      // Go back to defaults menu
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Text model', callback_data: 'setdef_text' }],
          [{ text: '🎨 Image model', callback_data: 'setdef_image' }],
          [{ text: '🎬 Video model', callback_data: 'setdef_video' }],
          [{ text: '🎵 Audio model', callback_data: 'setdef_audio' }],
          [{ text: '🔙 Назад', callback_data: 'settings_back' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройка моделей по умолчанию</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_back') {
      const settings = getSettings(chatId);
      const keyboard = {
        inline_keyboard: [
          [{ text: `📐 Формат: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `🤖 Модели по-умолчанию`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройки бота</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'settings_format') {
      const settings = getSettings(chatId);
      const formats = [
        { text: 'WEBP (Fast/Modern)', id: 'webp' },
        { text: 'JPG (Standard)', id: 'jpg' }
      ];
      const keyboard = {
        inline_keyboard: formats.map(f => [{ 
          text: `${settings.format === f.id ? '✅ ' : ''}${f.text}`, 
          callback_data: `setformat_${f.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_back' }]);
      bot.editMessageText('🖼 <b>Выберите формат файла</b>\n(WEBP рекомендуется для скорости):', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('setformat_')) {
      const format = data.replace('setformat_', '');
      const settings = getSettings(chatId);
      settings.format = format;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Формат: ${format}` });
      // Go back
      const keyboard = {
        inline_keyboard: [
          [{ text: `📐 Формат: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `🖼 Тип файла: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
          [{ text: `⚡️ Режим: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
          [{ text: `🤖 Модели по-умолчанию`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройки бота</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_mode') {
      const settings = getSettings(chatId);
      const modes = [
        { text: '❓ Всегда спрашивать', id: 'ask' },
        { text: '🎨 Только Картинки', id: 'image' },
        { text: '🎬 Только Видео', id: 'video' }
      ];
      const keyboard = {
        inline_keyboard: modes.map(m => [{ 
          text: `${(settings.defaultMode || 'ask') === m.id ? '✅ ' : ''}${m.text}`, 
          callback_data: `setmode_${m.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'settings_back' }]);
      bot.editMessageText('⚡️ <b>Режим быстрой генерации</b>\nВыберите, что делать сразу после ввода текста:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('setmode_')) {
      const mode = data.replace('setmode_', '');
      const settings = getSettings(chatId);
      settings.defaultMode = mode;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `Режим: ${mode}` });
      // Go back
      const keyboard = {
        inline_keyboard: [
          [{ text: `📐 Формат: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `🖼 Тип файла: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
          [{ text: `⚡️ Режим: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
          [{ text: `🤖 Модели по-умолчанию`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('⚙️ <b>Настройки бота</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
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
