require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

// Global State
let bot;
let botUserName = "Bot";
let botError = null;
let networkStatus = "ąśąĮąĖčåąĖą░ą╗ąĖąĘą░čåąĖčÅ...";
let manualWebhookUrl = "";
let connectionHistory = [];
let networkChecks = { dns: '...', ip_1_1_1_1: '...', tg_ip: '...', google: '...' };

const token = process.env.TELEGRAM_BOT_TOKEN;
const pollinationsKey = process.env.POLLINATIONS_API_KEY;

// Use /data for HuggingFace persistent storage, fallback to local
const HF_DATA_DIR = '/data';
const PROMPTS_FILE = (fs.existsSync(HF_DATA_DIR) ? path.join(HF_DATA_DIR, 'prompts.json') : path.join(__dirname, 'prompts.json'));
console.log(`­¤ōü Prompts file path: ${PROMPTS_FILE}`);

let airtablePromptsCache = [];
let lastUpdateId = 0;
// No longer using custom polling

// Polling removed in favor of Webhooks



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
        name: `Ōśü’ĖÅ ${r.fields.Name || 'Unnamed'}`,
        text: r.fields.SystemPrompt || ''
      })).filter(p => p.text);
      console.log(`Ō£ģ Airtable synced: ${airtablePromptsCache.length} prompts loaded.`);
    }
  } catch (err) {
    if (err.response) {
      console.error(`ŌØī Airtable Sync Error: URL: https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
      console.error(`ŌØī Airtable Response: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    } else {
      console.error('ŌØī Airtable Sync Error:', err.message);
    }
  }
}
setInterval(syncAirtable, 5 * 60 * 1000);

const CADAVRE_PROMPT = `## ROLE
You are Cadavre Exquis Prompt Generator. Create prompts for AI image generation in the "Exquisite Corpse" style ŌĆö surreal portraits where the character's body is divided into 3-5 style zones, seamlessly flowing into each other like a gradient.

## PROMPT STRUCTURE
Each prompt MUST contain these blocks in a single line without breaks:
1. OPENING ŌĆö image type + character + key unity condition
2. POSE ŌĆö character's pose
3. ZONE DIVISION ŌĆö explanation of the division principle
4. ZONE A (TOP) ŌĆö style of head and chest
5. ZONE B (MIDDLE) ŌĆö torso style
6. ZONE C (BOTTOM) ŌĆö legs style
7. UNITY CLAUSE ŌĆö critical requirement for anatomical integrity
8. BACKGROUND ŌĆö background/atmosphere
9. TECHNICAL ŌĆö quality, lighting, resolution

## TEMPLATE
A stunning full-body portrait of a single [GENDER/AGE], ONE CONSISTENT CHARACTER throughout the entire image. [POSE DESCRIPTION]. Their body is divided into THREE SEAMLESS STYLE ZONES that flow into each other like a gradient: TOP (head to chest): [STYLE A] aesthetic - [details of head, hair, makeup, jewelry, skin elements]. MIDDLE (chest to hips): [STYLE B] aesthetic - same person's torso shows [details of clothing, armor, textures, glowing elements]. BOTTOM (hips to feet): [STYLE C] aesthetic - same person's legs feature [details of skirt/pants, shoes, accessories on legs]. CRITICAL: identical facial features throughout, same skin tone, same body proportions, continuous anatomy. Only the SURFACE STYLE changes, not the person. Background: [description of background]. Dramatic cinematic lighting, vertical portrait, photorealistic quality, 8k resolution.

## RULES
1. SINGLE LINE ŌĆö no line breaks, everything through spaces and periods.
2. CONSISTENCY ŌĆö repeat "same person" in each zone.
3. TRANSITIONS ŌĆö use "flow into each other like a gradient".
4. DETAIL ŌĆö minimum 5-7 specific elements per zone.
5. COLOR PALETTE ŌĆö if specified, indicate "COLOR PALETTE: [colors] only".

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
    name: '­¤ÆĆ Cadavre Exquis', 
    text: CADAVRE_PROMPT
  },
  { 
    id: 'default', 
    name: '­¤ī¤ Standard', 
    text: 'Rewrite the following user request into a highly creative prompt for an AI image generator. Add artistic styles, lighting, and camera angles. Keep it concise, MAXIMUM 30 words! Make it in English language only. Output ONLY the raw prompt, no extra text, explanations, or quotes. The user request is: ' 
  },
  { 
    id: 'anime', 
    name: 'Ōø® Anime Style', 
    text: 'Convert the user request into a detailed anime-style prompt. Mention specific anime aesthetics like Makoto Shinkai lighting or Studio Ghibli vibes. High quality, 4k, vibrant colors. Output ONLY the improved English prompt: ' 
  },
  { 
    id: 'photo', 
    name: '­¤ōĖ Photorealistic', 
    text: 'Transform the user request into a ultra-realistic photographic prompt. Specify camera (Sony A7R IV), lens (85mm f/1.4), lighting (golden hour), and texture details. Output ONLY the improved English prompt: ' 
  },
  {
    id: 'video-pro',
    name: '­¤Ä¼ Video Expert',
    text: `You are an expert AI video prompt engineer. You receive a brief description of a desired video scene (in any language) and output a single, production-ready English video prompt.

## OUTPUT FORMAT
Return ONLY the final prompt text. No explanations, no labels, no markdown.

## PROMPT STRUCTURE (always follow this order)
1. SHOT TYPE & FRAMING: extreme close-up / close-up / medium / wide / establishing / POV / top-down / low angle / high angle / Dutch angle
2. CAMERA MOVEMENT + SPEED: specify exact move (dolly, pan, tilt, track, orbit, boom, crane, whip pan, crash zoom, Steadicam float, handheld v├®rit├®, static) + speed (glacially slow / slow / moderate / fast / whip-speed) + direction
3. SUBJECT + ACTION: who/what is in frame, what they are doing, body language, expression, clothing, key details
4. ENVIRONMENT & SETTING: location, time of day, weather, production design details, background elements
5. LIGHTING: key light direction, color temperature, contrast ratio, practical lights, motivated sources, shadows
6. LENS & DEPTH OF FIELD: focal length (24mm wide / 35mm / 50mm / 85mm portrait / 135mm telephoto), aperture feel (shallow bokeh f/1.4 vs deep focus f/11), anamorphic or spherical
7. STYLE & TEXTURE: film stock feel, grain, color grade, visual reference (decade, genre, director style ŌĆö no real names)
8. AUDIO DIRECTION: ambient sound, SFX, dialogue (with tone/emotion in parentheses), music presence or absence ŌĆö always specify "no music" if unwanted
9. QUALITY ANCHORS: always append ŌĆö smooth, steady, cinematic, professional quality, no jitter, constant speed

## RULES
- Every prompt must be SELF-CONTAINED: no pronouns referencing other scenes, no "same as before"
- Prompt length: 60ŌĆō150 words. Dense but readable.
- Default duration assumption: 5 seconds. If user specifies duration, adjust action density accordingly.
- For TRANSITIONS (user mentions "from A to B" or "ą┐ąĄčĆąĄčģąŠą┤"): describe START state ŌåÆ transformation style ŌåÆ END state ŌåÆ camera behavior during transition
- For DIALOGUE: write speech in natural sentence case, never ALL CAPS. Add tone: (whispered), (excited), (deadpan). Keep lines under 5 seconds of speech.
- NEVER include: real celebrity names, copyrighted characters, brand names, slurs
- If the scene is unclear or too vague, make bold creative choices ŌĆö do NOT ask questions
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
    // ąØąĄ čüąŠčģčĆą░ąĮčÅąĄą╝ ąŠą▒ą╗ą░čćąĮčŗąĄ ą┐čĆąŠą╝ą┐čéčŗ ą▓ ą╗ąŠą║ą░ą╗čīąĮčŗą╣ čäą░ą╣ą╗
    const promptsToSave = JSON.parse(JSON.stringify(prompts));
    for (const key in promptsToSave) {
      promptsToSave[key] = promptsToSave[key].filter(p => !p.id.startsWith('at_'));
    }
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(promptsToSave, null, 2));
  } catch (err) {
    console.error('Error saving prompts:', err);
  }
}


// Network Diagnostics logic
async function runDiagnostics() {
  dns.lookup('google.com', (err, addr) => { networkChecks.google = err ? `Err: ${err.code}` : 'OK'; });
  dns.lookup('one.one.one.one', (err, addr) => { networkChecks.dns = err ? `Err: ${err.code}` : 'OK'; });
  
  axios.get('https://1.1.1.1', { timeout: 5000 }).then(() => networkChecks.ip_1_1_1_1 = 'OK').catch(e => networkChecks.ip_1_1_1_1 = 'Blocked');
  axios.get('https://149.154.167.220', { timeout: 5000 }).then(() => networkChecks.tg_ip = 'OK').catch(e => networkChecks.tg_ip = 'Blocked (TG IP)');
}

// Resilient Setup Functions
async function performHandshake(token, mirror = null) {
  const baseUrl = (mirror || 'https://api.telegram.org').replace(/\/$/, '');
  const url = `${baseUrl}/bot${token}/getMe`;
  console.log(`­¤öŹ Handshake with: ${url}`);
  return axios.get(url, { timeout: 10000 });
}

async function setBotWebhook(token, webhookUrl, mirror = null) {
  const baseUrl = (mirror || 'https://api.telegram.org').replace(/\/$/, '');
  const url = `${baseUrl}/bot${token}/setWebHook?url=${encodeURIComponent(webhookUrl)}`;
  console.log(`­¤öŹ Setting Webhook: ${url}`);
  return axios.get(url, { timeout: 10000 });
}

async function initializeBot() {
  if (!token || !token.includes(':')) {
    botError = "ąØąĄą┤ąĄą╣čüčéą▓ąĖčéąĄą╗čīąĮčŗą╣ čéąŠą║ąĄąĮ Telegram-ą▒ąŠčéą░.";
    return;
  }

  runDiagnostics();
  process.env.NTBA_FIX_350 = 1;
  networkStatus = "ąØą░čüčéčĆąŠą╣ą║ą░ Webhook...";

  const spaceId = process.env.SPACE_ID || process.env.SPACE_REPO_NAME; 
  let webhookUrl = "";

  if (spaceId) {
    const parts = spaceId.split('/');
    const user = parts[0].toLowerCase().replace(/[\._]/g, '-');
    const space = parts[parts.length - 1].toLowerCase().replace(/[\._]/g, '-');
    webhookUrl = `https://${user}-${space}.hf.space/webhook/${token}`;
  } else {
    const host = process.env.HOSTNAME || 'localhost';
    webhookUrl = (host.includes('hf.space')) ? `https://${host}/webhook/${token}` : "";
  }

  const setupMirrors = [
    process.env.CUSTOM_TG_MIRROR,
    "https://api.telegram.org.dog",
    "https://telegg.xyz",
    "https://tproxy.xyz",
    "https://tg.i-c-a.su",
    "https://api.v-prox.com",
    "https://api.telegram-proxy.com",
    "https://api.extraton.io",
    "https://tgproxy.org",
    null // Direct
  ];

  console.log("­¤ōĪ ą¤ąŠą┐čŗčéą║ą░ ą░ą▓čéąŠą╝ą░čéąĖčćąĄčüą║ąŠą╣ ąĮą░čüčéčĆąŠą╣ą║ąĖ Webhook ąĖ ą┐ąŠąĖčüą║ą░ čĆą░ą▒ąŠčćąĄą│ąŠ ąĘąĄčĆą║ą░ą╗ą░...");
  let activeMirror = null;

  for (const mirror of setupMirrors) {
    try {
      if (!mirror && mirror !== null) continue; // Skip undefined/empty CUSTOM_TG_MIRROR

      const mirrorName = mirror || "ą¤čĆčÅą╝ąŠąĄ čüąŠąĄą┤ąĖąĮąĄąĮąĖąĄ";
      console.log(`­¤öä ą¤čĆąŠą▒čāąĄą╝ ąĘąĄčĆą║ą░ą╗ąŠ: ${mirrorName}...`);
      
      await performHandshake(token, mirror);
      console.log(`Ō£ģ ąŚąĄčĆą║ą░ą╗ąŠ ${mirrorName} čĆą░ą▒ąŠčéą░ąĄčé ąĮą░ ą▓čŗčģąŠą┤!`);
      
      activeMirror = mirror;

      if (webhookUrl) {
          try {
            await setBotWebhook(token, webhookUrl, mirror);
            console.log(`Ō£ģ Webhook čāčüčéą░ąĮąŠą▓ą╗ąĄąĮ čćąĄčĆąĄąĘ ${mirrorName}.`);
          } catch (whErr) {
            console.warn(`ŌÜĀ’ĖÅ ąØąĄ čāą┤ą░ą╗ąŠčüčī čāčüčéą░ąĮąŠą▓ąĖčéčī Webhook čćąĄčĆąĄąĘ ${mirrorName}: ${whErr.message}`);
          }
          const manualBase = mirror || "https://api.telegram.org";
          manualWebhookUrl = `${manualBase}/bot${token}/setWebHook?url=${encodeURIComponent(webhookUrl)}`;
      }
      
      break;
    } catch (e) {
      console.warn(`ŌÜĀ’ĖÅ ąŚąĄčĆą║ą░ą╗ąŠ ${mirror || "Direct"} ąĮąĄą┤ąŠčüčéčāą┐ąĮąŠ: ${e.message}`);
      connectionHistory.push(`[${new Date().toLocaleTimeString()}] ${mirror || 'Direct'}: ${e.message}`);
    }
  }

  if (!manualWebhookUrl && webhookUrl) {
      const bestMirror = setupMirrors.find(m => m !== null) || "https://api.telegram.org";
      manualWebhookUrl = `${bestMirror}/bot${token}/setWebHook?url=${encodeURIComponent(webhookUrl)}`;
  }

  // Initialize bot with working mirror
  if (!bot || (activeMirror && bot.options.baseApiUrl !== activeMirror)) {
    console.log(`­¤ż¢ ąśąĮąĖčåąĖą░ą╗ąĖąĘą░čåąĖčÅ ą▒ąŠčéą░ čü ą▒ą░ąĘąŠą▓čŗą╝ URL: ${activeMirror || 'Default'}`);
    bot = new TelegramBot(token, { 
        polling: false,
        baseApiUrl: activeMirror || undefined
    });
    // Reset handlers flag so they attach to new instance
    setupBotHandlers.done = false;
    setupBotHandlers();
  }

  const connectionFound = activeMirror !== undefined && activeMirror !== 'failed'; // We set activeMirror = null for direct, or a string for mirror

  if (activeMirror !== undefined || !webhookUrl) {
    networkStatus = `Webhook: Active | Mirror: ${activeMirror || 'Direct'}`;
    botError = null;
    try {
      const resp = await performHandshake(token, activeMirror);
      botUserName = resp.data.result.username;
    } catch(e) {
      // If even the chosen mirror fails secondary handshake
      if (activeMirror === null) {
         networkStatus = "Webhook: ąóčĆąĄą▒čāąĄčéčüčÅ čĆčāčćąĮą░čÅ ąĮą░čüčéčĆąŠą╣ą║ą░";
         botError = "ąśčüčģąŠą┤čÅčēąĖąĄ ąĘą░ą┐čĆąŠčüčŗ Direct ąĘą░ą▒ą╗ąŠą║ąĖčĆąŠą▓ą░ąĮčŗ. ą¤ąŠąČą░ą╗čāą╣čüčéą░, ą▓čŗą▒ąĄčĆąĖčéąĄ ąĘąĄčĆą║ą░ą╗ąŠ ąĖą╗ąĖ čāą║ą░ąČąĖčéąĄ CUSTOM_TG_MIRROR.";
      }
    }
  } else {
    networkStatus = "Webhook: ąóčĆąĄą▒čāąĄčéčüčÅ čĆčāčćąĮą░čÅ ąĮą░čüčéčĆąŠą╣ą║ą░";
    botError = "ąśčüčģąŠą┤čÅčēąĖąĄ ąĘą░ą┐čĆąŠčüčŗ ąĘą░ą▒ą╗ąŠą║ąĖčĆąŠą▓ą░ąĮčŗ. ą¤ąŠąČą░ą╗čāą╣čüčéą░, čāą║ą░ąČąĖčéąĄ čĆą░ą▒ąŠčćąĄąĄ ąĘąĄčĆą║ą░ą╗ąŠ ą▓ CUSTOM_TG_MIRROR ąĖą╗ąĖ ąĖčüą┐ąŠą╗čīąĘčāą╣čéąĄ ą║ąĮąŠą┐ą║čā ąĮąĖąČąĄ.";
  }
}

initializeBot();
setTimeout(syncAirtable, 3000); // ąŚą░ą┐čāčüą║ Airtable ą┐ą░čĆčüąĄčĆą░ ą┐ąŠčüą╗ąĄ čüčéą░čĆčéą░


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

// ===== CORE: ąŻąĮąĖą▓ąĄčĆčüą░ą╗čīąĮą░čÅ čäčāąĮą║čåąĖčÅ ą│ąĄąĮąĄčĆą░čåąĖąĖ (Text, Image, Video, Audio) =====
async function generateMedia(chatId, callbackQueryId, originalPrompt, preEnhancedPrompt, modelId, category, referenceImageUrl) {
  const settings = getSettings(chatId);
  const isVideo = category === 'video' || ['ltx-2', 'nova-reel', 'wan', 'wan-fast'].includes(modelId);
  const isAudio = category === 'audio' || ['elevenlabs', 'elevenmusic', 'acestep', 'scribe'].includes(modelId);
  const isText = category === 'text' || MODELS.text.some(m => m.id === modelId);

  try {
    if (callbackQueryId) {
      const respText = isVideo ? '­¤Ä¼ ąōąĄąĮąĄčĆąĖčĆčāčÄ ą▓ąĖą┤ąĄąŠ...' : (isAudio ? '­¤ÄĄ ąōąĄąĮąĄčĆąĖčĆčāčÄ ą░čāą┤ąĖąŠ...' : (isText ? '­¤Æ¼ ąōąĄąĮąĄčĆąĖčĆčāčÄ ąŠčéą▓ąĄčé...' : '­¤Ä© ąōąĄąĮąĄčĆąĖčĆčāčÄ ąĖąĘąŠą▒čĆą░ąČąĄąĮąĖąĄ...'));
      await bot.answerCallbackQuery(callbackQueryId, { text: respText });
    }

    const waitMsg = isVideo ? '­¤Ä¼ ąōąĄąĮąĄčĆąĖčĆčāčÄ ą▓ąĖą┤ąĄąŠ... (ą┤ąŠ 2 ą╝ąĖąĮ) ŌÅ│' : 
                   (isAudio ? '­¤ÄĄ ąōąĄąĮąĄčĆąĖčĆčāčÄ ą░čāą┤ąĖąŠ... ŌÅ│' : 
                   (isText ? '­¤Æ¼ ąöčāą╝ą░čÄ ąĮą░ą┤ ąŠčéą▓ąĄčéąŠą╝... ŌÅ│' : 
                   '­¤Ä© ąŻą╗čāčćčłą░čÄ ą┐čĆąŠą╝ą┐čé ąĖ čĆąĖčüčāčÄ... ŌÅ│'));
    const statusMsg = await bot.sendMessage(chatId, waitMsg);

    // --- 1. ąóąĄą║čüčéąŠą▓ą░čÅ ą│ąĄąĮąĄčĆą░čåąĖčÅ (LLM) ---
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
      if (!content) throw new Error('ą¤čāčüčéąŠą╣ ąŠčéą▓ąĄčé ąŠčé ą╝ąŠą┤ąĄą╗ąĖ');
      
      await bot.sendMessage(chatId, `­¤Æ¼ <b>ą×čéą▓ąĄčé (${modelId}):</b>\n\n${escapeHtml(content)}`, { parse_mode: 'HTML' });
      return;
    }

    // --- 2. ąŻą╗čāčćčłąĄąĮąĖąĄ ą┐čĆąŠą╝ą┐čéą░ (čéąŠą╗čīą║ąŠ ą┤ą╗čÅ ą║ą░čĆčéąĖąĮąŠą║ ąĖ ą▓ąĖą┤ąĄąŠ) ---
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
        console.warn('ŌÜĀ’ĖÅ ą×čłąĖą▒ą║ą░ čāą╗čāčćčłąĄąĮąĖčÅ:', err.message);
        enhancedPrompt = originalPrompt;
      }
    }
    if (!enhancedPrompt) enhancedPrompt = originalPrompt;

    // --- 3. ążąŠčĆą╝ąĖčĆąŠą▓ą░ąĮąĖąĄ URL ą┤ą╗čÅ ą£ąĄą┤ąĖą░ (Image, Video, Audio) ---
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

    console.log(`­¤īÉ API Request: ${apiUrl}`);

    const response = await axios.get(apiUrl, {
      responseType: 'arraybuffer',
      timeout: isVideo ? 180000 : 90000,
      headers: pollinationsKey ? { 'Authorization': `Bearer ${pollinationsKey}` } : {}
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || '';
    if (buffer.length < 500) throw new Error('Response too small - possible error');

    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    // --- 4. ą×čéą┐čĆą░ą▓ą║ą░ čĆąĄąĘčāą╗čīčéą░čéą░ ---
    const actionKeyboard = {
      inline_keyboard: [
        [
          { text: '­¤öä ąĪąĮąŠą▓ą░', callback_data: `action_regen` },
          category === 'image' ? { text: '­¤Ä¼ ąĪą┤ąĄą╗ą░čéčī ąÆąĖą┤ąĄąŠ', callback_data: 'action_image_to_video' } : null
        ].filter(Boolean)
      ]
    };

    const caption = isAudio ? `­¤ÄĄ <b>ąÉčāą┤ąĖąŠ:</b> ${originalPrompt}\n­¤ż¢ <b>ą£ąŠą┤ąĄą╗čī:</b> ${modelId}` :
                   `Ō£© <b>ą¤čĆąŠą╝ą┐čé:</b> <i>${escapeHtml(enhancedPrompt.substring(0, 500))}</i>\n­¤Ä© <b>ą£ąŠą┤ąĄą╗čī:</b> ${modelId}`;

    const sendOps = { caption, parse_mode: 'HTML', reply_markup: JSON.stringify(actionKeyboard) };

    // ąĪąŠčģčĆą░ąĮčÅąĄą╝ ąĖčüčéąŠčĆąĖčÄ ą┤ą╗čÅ ą▓ąŠąĘą╝ąŠąČąĮąŠčüčéąĖ ą┐ąĄčĆąĄą│ąĄąĮąĄčĆą░čåąĖąĖ
    userHistory.set(chatId, { originalPrompt, enhancedPrompt, modelId, category, referenceImageUrl });

    if (isAudio) {
      await bot.sendAudio(chatId, buffer, { caption, ...sendOps }, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    } else if (isVideo) {
      await bot.sendVideo(chatId, buffer, sendOps, { filename: 'video.mp4', contentType: 'video/mp4' });
    } else {
      // ą×čéą┐čĆą░ą▓ą╗čÅąĄą╝ čäąŠčéąŠ ąĖ ą┐ąŠą╗čāčćą░ąĄą╝ čüčéą░čéąĖčćąĮčāčÄ čüčüčŗą╗ą║čā ą┤ą╗čÅ Image-to-Video
      const sentMsg = await bot.sendPhoto(chatId, buffer, sendOps);
      
      const history = userHistory.get(chatId);
      if (sentMsg.photo && sentMsg.photo.length > 0) {
        const photoId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
        try {
          const fileLink = await bot.getFileLink(photoId);
          history.lastImageUrl = fileLink;
        } catch (e) {
          console.error("ą×čłąĖą▒ą║ą░ ą┐čĆąĖ ą┐ąŠą╗čāčćąĄąĮąĖąĖ file_link:", e.message);
          history.lastImageUrl = apiUrl; // Fallback
        }
      } else {
        history.lastImageUrl = apiUrl;
      }
      userHistory.set(chatId, history);
    }

  } catch (error) {
    console.error('ŌØī Generation Error:', error.message);
    await bot.sendMessage(chatId, `ŌØī ą×čłąĖą▒ą║ą░: ${escapeHtml(error.message)}`);
  }
}

function setupBotHandlers() {
  if (setupBotHandlers.done) return;
  setupBotHandlers.done = true;

  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const uptime = Math.floor(process.uptime());
    const statusInfo = `­¤ÜĆ <b>ąĪčéą░čéčāčü ą▒ąŠčéą░:</b>
Ō£ģ ąĀą░ą▒ąŠčéą░ąĄčé (online)
­¤ĢÆ ąÉą┐čéą░ą╣ą╝: ${uptime} čüąĄą║.
­¤ōĪ ąĪą▒ąŠčĆą║ą░: ${process.env.NODE_ENV || 'development'}
­¤ōŹ ąśąĮčüčéą░ąĮčü: ${process.env.HOSTNAME || 'Local/HF-Space'}
Ōśü’ĖÅ Airtable ą¤čĆąŠą╝ą┐čéąŠą▓: ${airtablePromptsCache.length}`;
    bot.sendMessage(chatId, statusInfo, { parse_mode: 'HTML' });
  });

  bot.onText(/\/sync/, async (msg) => {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN) {
      return bot.sendMessage(msg.chat.id, "ŌØī ą×čłąĖą▒ą║ą░: ąÆ ąĮą░čüčéčĆąŠą╣ą║ą░čģ ąĮąĄ čāą║ą░ąĘą░ąĮ čéąŠą║ąĄąĮ Airtable (`AIRTABLE_PERSONAL_ACCESS_TOKEN`)", { parse_mode: 'Markdown' });
    }
    bot.sendMessage(msg.chat.id, "­¤öä ąĪąĖąĮčģčĆąŠąĮąĖąĘąĖčĆčāčÄ čü Airtable...");
    await syncAirtable();
    bot.sendMessage(msg.chat.id, `Ō£ģ ąŻčüą┐ąĄčłąĮąŠ! ąŚą░ą│čĆčāąČąĄąĮąŠ ${airtablePromptsCache.length} ą┐čĆąŠą╝ą┐čéąŠą▓ ąĖąĘ ąŠą▒ą╗ą░ą║ą░.`);
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `­¤æŗ ą¤čĆąĖą▓ąĄčé! ą» ą╝ąŠčēąĮčŗą╣ ąśąś-ą▒ąŠčé.

ą¦čéąŠ čÅ čāą╝ąĄčÄ:
1’ĖÅŌāŻ ąōąĄąĮąĄčĆąĖčĆąŠą▓ą░čéčī **ą║ą░čĆčéąĖąĮą║ąĖ** ą┐ąŠ čéąĄą║čüčéčā (ą» ą▓čüąĄą│ą┤ą░ čüą░ą╝ čāą╗čāčćčłą░čÄ ą▓ą░čłąĖ ą┐čĆąŠą╝ą┐čéčŗ!)
2’ĖÅŌāŻ ąĀąĄą┤ą░ą║čéąĖčĆąŠą▓ą░čéčī **čéą▓ąŠąĖ čäąŠčéąŠ** (ą×čéą┐čĆą░ą▓čī čäąŠčéąŠ čü ą┐ąŠą┤ą┐ąĖčüčīčÄ, čćčéąŠ ąĖąĘą╝ąĄąĮąĖčéčī)
3’ĖÅŌāŻ ąöąĄą╗ą░čéčī **ą▓ąĖą┤ąĄąŠ** ąĖąĘ čéąĄą║čüčéą░ ąĖą╗ąĖ ą║ą░čĆčéąĖąĮąŠą║

­¤øĀ ąØą░čüčéčĆąŠą╣ą║ąĖ: /settings
­¤ōŗ ąĪą┐ąĖčüąŠą║ ą┐čĆąŠą╝ą┐čéąŠą▓: /prompts`;
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
        text: `${isSelected ? 'Ō£ģ ' : ''}${p.name}`, 
        callback_data: `p_select_${p.id}` 
      }, {
        text: '­¤Śæ',
        callback_data: `p_del_${p.id}`
      }]);
    });
    keyboard.push([{ text: 'Ō×Ģ ąöąŠą▒ą░ą▓ąĖčéčī ąĮąŠą▓čŗą╣', callback_data: 'p_add' }]);

    bot.sendMessage(chatId, '­¤Śé <b>ąÆą░čłąĖ čüąĖčüčéąĄą╝ąĮčŗąĄ ą┐čĆąŠą╝ą┐čéčŗ</b>\nąÆčŗą▒ąĄčĆąĖčéąĄ ą░ą║čéąĖą▓ąĮčŗą╣ ą┐čĆąŠą╝ą┐čé ąĖą╗ąĖ čüąŠąĘą┤ą░ą╣čéąĄ ąĮąŠą▓čŗą╣:', { 
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  });

  bot.onText(/\/prompt/, (msg) => {
    bot.sendMessage(msg.chat.id, "ąÜąŠą╝ą░ąĮą┤ą░ /prompt čéąĄą┐ąĄčĆčī ąĘą░ą╝ąĄąĮąĄąĮą░ ąĮą░ /prompts ą┤ą╗čÅ čāą┐čĆą░ą▓ą╗ąĄąĮąĖčÅ čüą┐ąĖčüą║ąŠą╝ ą┐čĆąŠą╝ą┐čéąŠą▓.");
  });

  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    if (settings.state) {
      settings.state = null;
      settings.tempNewPromptName = null;
      userSettings.set(chatId, settings);
      bot.sendMessage(chatId, 'ąöąĄą╣čüčéą▓ąĖąĄ ąŠčéą╝ąĄąĮąĄąĮąŠ.');
    }
  });

  bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const settings = getSettings(chatId);
    const keyboard = {
      inline_keyboard: [
        [{ text: `­¤ōÉ ążąŠčĆą╝ą░čé: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
        [{ text: `­¤¢╝ ąóąĖą┐ čäą░ą╣ą╗ą░: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
        [{ text: `ŌÜĪ’ĖÅ ąĀąĄąČąĖą╝: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
        [{ text: `­¤ż¢ ą£ąŠą┤ąĄą╗ąĖ ą┐ąŠ-čāą╝ąŠą╗čćą░ąĮąĖčÄ`, callback_data: 'settings_defaults' }]
      ]
    };
    bot.sendMessage(chatId, 'ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ąĖ ą▒ąŠčéą░</b>\nąÆčŗą▒ąĄčĆąĖčéąĄ ą┐ą░čĆą░ą╝ąĄčéčĆ ą┤ą╗čÅ ąĖąĘą╝ąĄąĮąĄąĮąĖčÅ:', { parse_mode: 'HTML', reply_markup: JSON.stringify(keyboard) });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userInput = msg.text;
    const settings = getSettings(chatId);
    
    // ąæąøą×ąÜ 1: ą×ą▒čĆą░ą▒ąŠčéą║ą░ ą£ą░čüčéąĄčĆą░ čüąŠąĘą┤ą░ąĮąĖčÅ ą┐čĆąŠą╝ą┐čéąŠą▓ (ąÆą½ąĪą©ąśąÖ ą¤ąĀąśą×ąĀąśąóąĢąó)
    if (settings.state === 'waiting_for_new_prompt_name' && userInput && !userInput.startsWith('/')) {
      settings.tempNewPromptName = userInput;
      settings.state = 'waiting_for_new_prompt_text';
      userSettings.set(chatId, settings);
      return bot.sendMessage(chatId, `ą¤čĆąĖąĮčÅčéąŠ ąĮą░ąĘą▓ą░ąĮąĖąĄ: <b>${escapeHtml(userInput)}</b>\n\nąóąĄą┐ąĄčĆčī ąŠčéą┐čĆą░ą▓čīčéąĄ čüą░ą╝ čéąĄą║čüčé čüąĖčüčéąĄą╝ąĮąŠą│ąŠ ą┐čĆąŠą╝ą┐čéą░:`, { parse_mode: 'HTML' });
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
      return bot.sendMessage(chatId, `Ō£ģ ą¤čĆąŠą╝ą┐čé <b>${escapeHtml(newPrompt.name)}</b> čüąŠčģčĆą░ąĮąĄąĮ!`, { parse_mode: 'HTML' });
    }

    if (settings.state === 'waiting_for_video_prompt' && userInput && !userInput.startsWith('/')) {
      const history = userHistory.get(chatId);
      settings.state = null;
      userSettings.set(chatId, settings);
      if (!history || !history.lastImageUrl) return bot.sendMessage(chatId, "ŌØī ą×čłąĖą▒ą║ą░: ą▒ą░ąĘąŠą▓ąŠąĄ ąĖąĘąŠą▒čĆą░ąČąĄąĮąĖąĄ ą┐ąŠčéąĄčĆčÅąĮąŠ.");
      return generateMedia(chatId, null, userInput, null, settings.defaults.video, 'video', history.lastImageUrl);
    }

    if (userInput && userInput.startsWith('/')) return;

    if (userInput) {
      console.log(`­¤ō® Prompt from @${msg.from.username || 'unknown'}: "${userInput}"`);
      userHistory.set(chatId, { originalPrompt: userInput });

      // ąĢčüą╗ąĖ čāčüčéą░ąĮąŠą▓ą╗ąĄąĮ čĆąĄąČąĖą╝ ą┐ąŠ čāą╝ąŠą╗čćą░ąĮąĖčÄ (ąĮąĄ "ask"), ąĘą░ą┐čāčüą║ą░ąĄą╝ ą│ąĄąĮąĄčĆą░čåąĖčÄ čüčĆą░ąĘčā
      if (settings.defaultMode && settings.defaultMode !== 'ask') {
        const category = settings.defaultMode;
        const modelId = settings.defaults[category];
        return generateMedia(chatId, null, userInput, null, modelId, category, null);
      }

      const categoryKeyboard = {
        inline_keyboard: [[
          { text: '­¤Ä© ąÜą░čĆčéąĖąĮą║ą░', callback_data: 'cat_image' },
          { text: '­¤Ä¼ ąÆąĖą┤ąĄąŠ', callback_data: 'cat_video' }
        ], [
          { text: '­¤ÄĄ ąÉčāą┤ąĖąŠ', callback_data: 'cat_audio' },
          { text: '­¤Æ¼ ąóąĄą║čüčé', callback_data: 'cat_text' }
        ]]
      };

      await bot.sendMessage(chatId, `ą¦čéąŠ čüąŠąĘą┤ą░ąĄą╝ ą┤ą╗čÅ ą┐čĆąŠą╝ą┐čéą░:\n"${userInput}"?`, {
        reply_markup: JSON.stringify(categoryKeyboard)
      });
    }

    // ą×ą▒čĆą░ą▒ąŠčéą║ą░ ążąŠčéąŠ (ą┤ą╗čÅ čĆąĄą┤ą░ą║čéąĖčĆąŠą▓ą░ąĮąĖčÅ)
    if (msg.photo && !userInput) {
      const captionText = msg.caption || 'Make it look better and more high quality';
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const fileLink = await bot.getFileLink(photoId); 
        await generateMedia(chatId, null, captionText, null, 'klein', 'image', fileLink); 
      } catch (err) {
        bot.sendMessage(chatId, "ŌØī ą×čłąĖą▒ą║ą░ ą┐ąŠą╗čāčćąĄąĮąĖčÅ ą║ą░čĆčéąĖąĮą║ąĖ.");
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
      
      bot.answerCallbackQuery(query.id, { text: `ąÉą║čéąĖą▓ąĄąĮ: ${prompt ? prompt.name : promptId}` });
      
      // ą×ą▒ąĮąŠą▓ą╗čÅąĄą╝ čüą┐ąĖčüąŠą║, čćčéąŠą▒čŗ ą┐ąŠą║ą░ąĘą░čéčī ą│ą░ą╗ąŠčćą║čā
      let keyboard = [];
      userPrompts.forEach(p => {
        const isSelected = p.id === settings.activePromptId;
        keyboard.push([{ 
          text: `${isSelected ? 'Ō£ģ ' : ''}${p.name}`, 
          callback_data: `p_select_${p.id}` 
        }, {
          text: '­¤Śæ',
          callback_data: `p_del_${p.id}`
        }]);
      });
      keyboard.push([{ text: 'Ō×Ģ ąöąŠą▒ą░ą▓ąĖčéčī ąĮąŠą▓čŗą╣', callback_data: 'p_add' }]);
      
      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    if (data.startsWith('p_del_')) {
      const promptId = data.replace('p_del_', '');
      if (promptId === 'default') return bot.answerCallbackQuery(query.id, { text: 'ąØąĄą╗čīąĘčÅ čāą┤ą░ą╗ąĖčéčī čüčéą░ąĮą┤ą░čĆčéąĮčŗą╣ ą┐čĆąŠą╝ą┐čé', show_alert: true });
      if (promptId.startsWith('at_')) return bot.answerCallbackQuery(query.id, { text: 'ąŁčéąŠčé ą┐čĆąŠą╝ą┐čé čāą┐čĆą░ą▓ą╗čÅąĄčéčüčÅ čćąĄčĆąĄąĘ Airtable', show_alert: true });
      
      const allPrompts = loadSavedPrompts();
      if (!allPrompts[chatId]) {
        allPrompts[chatId] = [...(allPrompts.global || getGlobalPrompts())];
      }
      
      allPrompts[chatId] = allPrompts[chatId].filter(p => p.id !== promptId);
      saveSavedPrompts(allPrompts);
      
      const settings = getSettings(chatId);
      if (settings.activePromptId === promptId) settings.activePromptId = 'default';
      userSettings.set(chatId, settings);
      
      bot.answerCallbackQuery(query.id, { text: 'ąŻą┤ą░ą╗ąĄąĮąŠ' });
      
      // ą×ą▒ąĮąŠą▓ą╗čÅąĄą╝ čüą┐ąĖčüąŠą║
      const userPrompts = allPrompts[chatId];
      let keyboard = [];
      userPrompts.forEach(p => {
        const isSelected = p.id === settings.activePromptId;
        keyboard.push([{ 
          text: `${isSelected ? 'Ō£ģ ' : ''}${p.name}`, 
          callback_data: `p_select_${p.id}` 
        }, {
          text: '­¤Śæ',
          callback_data: `p_del_${p.id}`
        }]);
      });
      keyboard.push([{ text: 'Ō×Ģ ąöąŠą▒ą░ą▓ąĖčéčī ąĮąŠą▓čŗą╣', callback_data: 'p_add' }]);
      
      bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    if (data === 'p_add') {
      const settings = getSettings(chatId);
      settings.state = 'waiting_for_new_prompt_name';
      userSettings.set(chatId, settings);
      bot.sendMessage(chatId, '­¤ōØ ąÆą▓ąĄą┤ąĖčéąĄ ąĮą░ąĘą▓ą░ąĮąĖąĄ ą┤ą╗čÅ ą▓ą░čłąĄą│ąŠ ąĮąŠą▓ąŠą│ąŠ čüąĖčüčéąĄą╝ąĮąŠą│ąŠ ą┐čĆąŠą╝ą┐čéą░:');
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('cat_')) {
      const category = data.replace('cat_', '');
      const history = userHistory.get(chatId);
      const settings = getSettings(chatId);
      const defaultModel = settings.defaults[category];
      
      bot.editMessageText(`ąÆčŗą▒čĆą░ąĮą░ ą║ą░čéąĄą│ąŠčĆąĖčÅ: <b>${category}</b>. ąśčüą┐ąŠą╗čīąĘčāčÄ ą╝ąŠą┤ąĄą╗čī ą┐ąŠ čāą╝ąŠą╗čćą░ąĮąĖčÄ: <b>${defaultModel}</b>.`, {
        chat_id: chatId, 
        message_id: query.message.message_id, 
        parse_mode: 'HTML'
      });
      
      generateMedia(chatId, query.id, history.originalPrompt, null, defaultModel, category, null);
      return;
    }

    if (data === 'action_image_to_video') {
      const history = userHistory.get(chatId);
      if (!history || !history.lastImageUrl) return bot.answerCallbackQuery(query.id, { text: 'ą×čłąĖą▒ą║ą░: ą║ą░čĆčéąĖąĮą║ą░ ąĮąĄ ąĮą░ą╣ą┤ąĄąĮą░', show_alert: true });
      
      const settings = getSettings(chatId);
      settings.state = 'waiting_for_video_prompt';
      userSettings.set(chatId, settings);
      
      bot.sendMessage(chatId, "­¤Ä¼ <b>ąĀąĄąČąĖą╝ čüąŠąĘą┤ą░ąĮąĖčÅ ą▓ąĖą┤ąĄąŠ ąĖąĘ ą║ą░čĆčéąĖąĮą║ąĖ</b>\ną×ą┐ąĖčłąĖčéąĄ, čćčéąŠ ą┤ąŠą╗ąČąĮąŠ ą┐čĆąŠąĖąĘąŠą╣čéąĖ ąĮą░ ą▓ąĖą┤ąĄąŠ (ą┤ą▓ąĖąČąĄąĮąĖąĄ, čŹčäčäąĄą║čéčŗ):", { parse_mode: 'HTML' });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'action_regen') {
      const history = userHistory.get(chatId);
      if (!history) return bot.answerCallbackQuery(query.id, { text: 'ąØąĄčé ąĖčüčéąŠčĆąĖąĖ', show_alert: true });
      generateMedia(chatId, query.id, history.originalPrompt, history.enhancedPrompt, history.modelId, history.category, history.lastImageUrl);
      return;
    }

    // --- Settings Logic ---
    if (data === 'settings_ar') {
      const settings = getSettings(chatId);
      const arList = [
        { text: '­¤ö▓ 1:1 (1024x1024)', id: '1024x1024' },
        { text: '­¤ō▒ 3:4 (768x1024)', id: '768x1024' },
        { text: '­¤Æ╗ 4:3 (1024x768)', id: '1024x768' }
      ];
      const keyboard = {
        inline_keyboard: arList.map(ar => [{ 
          text: `${settings.aspectRatio === ar.id ? 'Ō£ģ ' : ''}${ar.text}`, 
          callback_data: `ar_${ar.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_back' }]);
      bot.editMessageText('­¤ōÉ ąÆčŗą▒ąĄčĆąĖčéąĄ čäąŠčĆą╝ą░čé ąĖąĘąŠą▒čĆą░ąČąĄąĮąĖą╣:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('ar_')) {
      const aspectRatio = data.replace('ar_', '');
      const settings = getSettings(chatId);
      settings.aspectRatio = aspectRatio;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `ąĪąŠčģčĆą░ąĮąĄąĮ čäąŠčĆą╝ą░čé: ${aspectRatio}` });
      
      const keyboard = {
        inline_keyboard: [
          [{ text: `­¤ōÉ ążąŠčĆą╝ą░čé: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `­¤ż¢ ą£ąŠą┤ąĄą╗ąĖ ą┐ąŠ-čāą╝ąŠą╗čćą░ąĮąĖčÄ`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ąĖ ą▒ąŠčéą░</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_llm' || data === 'settings_defaults') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '­¤Æ¼ Default Text', callback_data: 'setdef_text' }],
          [{ text: '­¤Ä© Default Image', callback_data: 'setdef_image' }],
          [{ text: '­¤Ä¼ Default Video', callback_data: 'setdef_video' }],
          [{ text: '­¤ÄĄ Default Audio', callback_data: 'setdef_audio' }],
          [{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_back' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ą░ ą╝ąŠą┤ąĄą╗ąĄą╣ ą┐ąŠ čāą╝ąŠą╗čćą░ąĮąĖčÄ</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
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
          text: `${currentDef === m.id ? 'Ō£ģ ' : ''}${m.name}`, 
          callback_data: `save_def_${cat}_${m.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_defaults' }]);
      bot.editMessageText(`ąÆčŗą▒ąĄčĆąĖčéąĄ ą╝ąŠą┤ąĄą╗čī ą┐ąŠ čāą╝ąŠą╗čćą░ąĮąĖčÄ ą┤ą╗čÅ <b>${cat}</b>:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
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
      bot.answerCallbackQuery(query.id, { text: `ąĪąŠčģčĆą░ąĮąĄąĮąŠ: ${modelId}` });
      // Go back to defaults menu
      const keyboard = {
        inline_keyboard: [
          [{ text: '­¤Æ¼ Text model', callback_data: 'setdef_text' }],
          [{ text: '­¤Ä© Image model', callback_data: 'setdef_image' }],
          [{ text: '­¤Ä¼ Video model', callback_data: 'setdef_video' }],
          [{ text: '­¤ÄĄ Audio model', callback_data: 'setdef_audio' }],
          [{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_back' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ą░ ą╝ąŠą┤ąĄą╗ąĄą╣ ą┐ąŠ čāą╝ąŠą╗čćą░ąĮąĖčÄ</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_back') {
      const settings = getSettings(chatId);
      const keyboard = {
        inline_keyboard: [
          [{ text: `­¤ōÉ ążąŠčĆą╝ą░čé: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `­¤ż¢ ą£ąŠą┤ąĄą╗ąĖ ą┐ąŠ-čāą╝ąŠą╗čćą░ąĮąĖčÄ`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ąĖ ą▒ąŠčéą░</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
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
          text: `${settings.format === f.id ? 'Ō£ģ ' : ''}${f.text}`, 
          callback_data: `setformat_${f.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_back' }]);
      bot.editMessageText('­¤¢╝ <b>ąÆčŗą▒ąĄčĆąĖčéąĄ čäąŠčĆą╝ą░čé čäą░ą╣ą╗ą░</b>\n(WEBP čĆąĄą║ąŠą╝ąĄąĮą┤čāąĄčéčüčÅ ą┤ą╗čÅ čüą║ąŠčĆąŠčüčéąĖ):', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('setformat_')) {
      const format = data.replace('setformat_', '');
      const settings = getSettings(chatId);
      settings.format = format;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `ążąŠčĆą╝ą░čé: ${format}` });
      // Go back
      const keyboard = {
        inline_keyboard: [
          [{ text: `­¤ōÉ ążąŠčĆą╝ą░čé: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `­¤¢╝ ąóąĖą┐ čäą░ą╣ą╗ą░: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
          [{ text: `ŌÜĪ’ĖÅ ąĀąĄąČąĖą╝: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
          [{ text: `­¤ż¢ ą£ąŠą┤ąĄą╗ąĖ ą┐ąŠ-čāą╝ąŠą╗čćą░ąĮąĖčÄ`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ąĖ ą▒ąŠčéą░</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

    if (data === 'settings_mode') {
      const settings = getSettings(chatId);
      const modes = [
        { text: 'ŌØō ąÆčüąĄą│ą┤ą░ čüą┐čĆą░čłąĖą▓ą░čéčī', id: 'ask' },
        { text: '­¤Ä© ąóąŠą╗čīą║ąŠ ąÜą░čĆčéąĖąĮą║ąĖ', id: 'image' },
        { text: '­¤Ä¼ ąóąŠą╗čīą║ąŠ ąÆąĖą┤ąĄąŠ', id: 'video' }
      ];
      const keyboard = {
        inline_keyboard: modes.map(m => [{ 
          text: `${(settings.defaultMode || 'ask') === m.id ? 'Ō£ģ ' : ''}${m.text}`, 
          callback_data: `setmode_${m.id}` 
        }])
      };
      keyboard.inline_keyboard.push([{ text: '­¤öÖ ąØą░ąĘą░ą┤', callback_data: 'settings_back' }]);
      bot.editMessageText('ŌÜĪ’ĖÅ <b>ąĀąĄąČąĖą╝ ą▒čŗčüčéčĆąŠą╣ ą│ąĄąĮąĄčĆą░čåąĖąĖ</b>\nąÆčŗą▒ąĄčĆąĖčéąĄ, čćčéąŠ ą┤ąĄą╗ą░čéčī čüčĆą░ąĘčā ą┐ąŠčüą╗ąĄ ą▓ą▓ąŠą┤ą░ čéąĄą║čüčéą░:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('setmode_')) {
      const mode = data.replace('setmode_', '');
      const settings = getSettings(chatId);
      settings.defaultMode = mode;
      userSettings.set(chatId, settings);
      bot.answerCallbackQuery(query.id, { text: `ąĀąĄąČąĖą╝: ${mode}` });
      // Go back
      const keyboard = {
        inline_keyboard: [
          [{ text: `­¤ōÉ ążąŠčĆą╝ą░čé: ${settings.aspectRatio}`, callback_data: 'settings_ar' }],
          [{ text: `­¤¢╝ ąóąĖą┐ čäą░ą╣ą╗ą░: ${settings.format || 'webp'}`, callback_data: 'settings_format' }],
          [{ text: `ŌÜĪ’ĖÅ ąĀąĄąČąĖą╝: ${settings.defaultMode || 'ask'}`, callback_data: 'settings_mode' }],
          [{ text: `­¤ż¢ ą£ąŠą┤ąĄą╗ąĖ ą┐ąŠ-čāą╝ąŠą╗čćą░ąĮąĖčÄ`, callback_data: 'settings_defaults' }]
        ]
      };
      bot.editMessageText('ŌÜÖ’ĖÅ <b>ąØą░čüčéčĆąŠą╣ą║ąĖ ą▒ąŠčéą░</b>', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    }

  });
}


const app = express();
app.use(express.json()); // Essential for Webhooks

// Webhook endpoint
app.post(`/webhook/${token}`, (req, res) => {
  if (bot) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200);
});

// GET handler for convenience/testing
app.get(`/webhook/${token}`, (req, res) => {
  res.send(`Ō£ģ Webhook endpoint is alive and waiting for POST updates from Telegram.`);
});

app.get('/', (req, res) => {
  const historyHtml = connectionHistory.length > 0 
    ? `<h3>ąśčüčéąŠčĆąĖčÅ ą┐ąŠą┐čŗčéąŠą║:</h3><ul>${connectionHistory.map(line => `<li>${line}</li>`).join('')}</ul>` 
    : '';

  const diagHtml = `
    <div style="background: #eee; padding: 10px; margin: 10px 0; font-family: monospace; font-size: 0.9em; text-align: left;">
        <b>ąöąĖą░ą│ąĮąŠčüčéąĖą║ą░ (ą×ą▒ąĮąŠą▓ąĖčéąĄ čüčéčĆą░ąĮąĖčåčā čćąĄčĆąĄąĘ 15 čüąĄą║):</b><br>
        - DNS Google (8.8.8.8): ${networkChecks.dns}<br>
        - IP Cloudflare (1.1.1.1): ${networkChecks.ip_1_1_1_1}<br>
        - IP Telegram (149.154.167.220): ${networkChecks.tg_ip}<br>
        - Host Google.com (DNS Test): ${networkChecks.google}
    </div>
  `;

  const manualDirectUrl = `https://api.telegram.org/bot${token}/setWebHook?url=${encodeURIComponent(webhookUrl)}`;
  const displayToken = token ? `${token.split(':')[0]}:***` : 'None';

  if (botError) {
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: auto;">
        <h1 style="color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">ŌØī ą¤čĆąŠą▒ą╗ąĄą╝ą░ čü ąĘą░ą┐čāčüą║ąŠą╝</h1>
        <div style="background: #fdf2f2; border-left: 5px solid #e74c3c; padding: 15px; margin: 20px 0;">
            <strong>ąĪčéą░čéčāčü čüąĄčéąĖ:</strong> ${networkStatus}<br>
            <strong>ąóąĄą║čāčēą░čÅ ąŠčłąĖą▒ą║ą░:</strong> ${botError}
        </div>
        ${diagHtml}
        <div style="background: #fcf8f3; border: 1px solid #faebcc; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <b>ąÆą░čĆąĖą░ąĮčéčŗ ąĮą░čüčéčĆąŠą╣ą║ąĖ (ąĮą░ąČą╝ąĖčéąĄ ąŠą┤ąĖąĮ):</b><br><br>
            <a href="${manualWebhookUrl}" target="_blank" style="background: #e67e22; color: white; padding: 8px 15px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block; margin-bottom: 10px;">1. ą¦ąĄčĆąĄąĘ ą▓čŗą▒čĆą░ąĮąĮąŠąĄ ąĘąĄčĆą║ą░ą╗ąŠ</a><br>
            <a href="${manualDirectUrl}" target="_blank" style="background: #34495e; color: white; padding: 8px 15px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block;">2. ąØą░ą┐čĆčÅą╝čāčÄ (čćąĄčĆąĄąĘ api.telegram.org)</a>
            <p style="font-size: 0.8em; color: #7f8c8d; margin-top: 10px;">ąĢčüą╗ąĖ ą┐čĆąĖ ąĮą░ąČą░čéąĖąĖ ąĮąĖčćąĄą│ąŠ ąĮąĄ ą┐čĆąŠąĖčüčģąŠą┤ąĖčé ŌĆö ą┐čĆąŠą▓ąĄčĆčīčéąĄ, čćčéąŠ čüčüčŗą╗ą║ą░ ąĮąĖąČąĄ čüąŠą┤ąĄčĆąČąĖčé ą▓ąĄčĆąĮčŗą╣ URL Webhook:</p>
            <code style="word-break: break-all; background: #eee; padding: 5px; display: block; margin-top: 5px;">${webhookUrl}</code>
        </div>
        <div style="font-size: 0.85em; color: #666; background: #f9f9f9; padding: 10px; border: 1px solid #ddd;">
            <b>ąóąĄčģąĮąĖčćąĄčüą║ą░čÅ ąĖąĮčäąŠ:</b><br>
            Token: ${displayToken}<br>
            Webhook: ${webhookUrl || 'Not detected'}<br>
            Host: ${process.env.HOSTNAME || 'Local'}
        </div>
        ${historyHtml}
      </div>
    `);
  } else {
    res.send(`
      <div style="font-family: sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: auto; text-align: center;">
        <h1 style="color: #27ae60;">Ō£ģ ąæąŠčé "@${botUserName}" ąĘą░ą┐čāčēąĄąĮ!</h1>
        <div style="background: #f1f8f4; padding: 20px; border-radius: 10px; border: 1px solid #d4edda; margin: 20px 0;">
            <p style="font-size: 1.2em; color: #155724;"><strong>ą¤ą░čĆą░ą╝ąĄčéčĆčŗ čüąĄčéąĖ:</strong> ${networkStatus}</p>
            ${diagHtml}
            <p>ąĪčéą░čéčāčü: <b>Online</b> | Uptime: ${Math.floor(process.uptime())} čüąĄą║.</p>
        </div>
        <a href="https://t.me/${botUserName}" target="_blank" style="display: inline-block; background: #0088cc; color: white; padding: 10px 25px; border-radius: 50px; text-decoration: none; font-weight: bold;">Ō×Ī’ĖÅ ą×čéą║čĆčŗčéčī ą▓ Telegram</a>
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">Hugging Face Space Deployment (Private)</p>
      </div>
    `);
  }
});
app.listen(process.env.PORT || 7860, '0.0.0.0', () => {
    console.log('ą×ą▒ą╗ą░čćąĮčŗą╣ čüąĄčĆą▓ąĄčĆ ąĘą░ą┐čāčēąĄąĮ ąĮą░ 7860');
    // Start bot logic
    syncAirtable();
    initializeBot();
});
