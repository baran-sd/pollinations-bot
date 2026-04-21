const fs = require('fs');
const path = require('path');

const oldCode = fs.readFileSync('scratch/index_9_days_ago_v2.js', 'utf8');
const newCode = fs.readFileSync('scratch/index_current_v2.js', 'utf8');

// 1. Extract Airtable logic from newCode
const airtablePart = `
let airtablePromptsCache = [];
async function syncAirtable() {
  let token_key = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
  let baseId = (process.env.AIRTABLE_BASE_ID || '').trim();
  let tableName = (process.env.AIRTABLE_TABLE_NAME || 'Prompts').trim();
  const match = baseId.match(/(app[a-zA-Z0-9]+)/);
  if (match) baseId = match[1];
  if (!token_key || !baseId) return;
  const url = \`https://api.airtable.com/v0/\${baseId}/\${encodeURIComponent(tableName)}\`;
  try {
    const response = await (require('axios')).get(url, { headers: { 'Authorization': \`Bearer \${token_key}\` } });
    if (response.data && response.data.records) {
      airtablePromptsCache = response.data.records.map(r => ({
        id: \`at_\${r.id}\`,
        name: \`Ōśü’ĖÅ \${r.fields.Name || 'Unnamed'}\`,
        text: r.fields.SystemPrompt || ''
      })).filter(p => p.text);
      console.log(\`Ō£ģ Airtable synced: \${airtablePromptsCache.length} prompts loaded.\`);
    }
  } catch (err) {
    console.error('ŌØī Airtable Sync Error:', err.message);
  }
}
`;

const globalPromptsPart = `
function getGlobalPrompts() {
  if (airtablePromptsCache.length > 0) {
    return [...DEFAULT_PROMPTS, ...airtablePromptsCache];
  }
  return DEFAULT_PROMPTS;
}
`;

// 2. Identify insertion points in oldCode
let merged = oldCode;

// Add Airtable logic after dns part
merged = merged.replace("dns.setServers(['8.8.8.8', '8.8.4.4']);", "dns.setServers(['8.8.8.8', '8.8.4.4']);" + airtablePart);

// Add getGlobalPrompts
merged = merged.replace("const DEFAULT_PROMPTS = [", globalPromptsPart + "\nconst DEFAULT_PROMPTS = [");

// Replace load/save functions
const newLoadSave = `function loadSavedPrompts() {
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
    const promptsToSave = JSON.parse(JSON.stringify(prompts));
    for (const key in promptsToSave) {
      promptsToSave[key] = promptsToSave[key].filter(p => !p.id.startsWith('at_'));
    }
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(promptsToSave, null, 2));
  } catch (err) {
    console.error('Error saving prompts:', err);
  }
}
`;

const oldLoadSaveRegex = /function loadSavedPrompts\(\) \{[\s\S]*?\}\s*function saveSavedPrompts\(prompts\) \{[\s\S]*?\}/;
merged = merged.replace(oldLoadSaveRegex, newLoadSave);

// Add /sync command and updated /status
const syncCommandHandler = `
  bot.onText(/\\/sync/, async (msg) => {
    if (!process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN) {
      return bot.sendMessage(msg.chat.id, "ŌØī Error: AIRTABLE_PERSONAL_ACCESS_TOKEN is missing.");
    }
    bot.sendMessage(msg.chat.id, "­¤öä Syncing with Airtable...");
    await syncAirtable();
    bot.sendMessage(msg.chat.id, \`Ō£ģ Sync complete! Loaded \${airtablePromptsCache.length} prompts.\`);
  });
`;

merged = merged.replace("bot.onText(/\\/status/, (msg) => {", syncCommandHandler + "\n  bot.onText(/\\/status/, (msg) => {");

// Update status to show Airtable count
merged = merged.replace("bot.sendMessage(chatId, statusInfo, { parse_mode: 'HTML' });", 
  "statusInfo += \`\\nŌśü’ĖÅ Airtable prompts: \${airtablePromptsCache.length}\`;\n    bot.sendMessage(chatId, statusInfo, { parse_mode: 'HTML' });");

// Add sync cycle at the end (before initializeBot() or just at the end of the script part)
merged = merged.replace("initializeBot();", "initializeBot();\nsetInterval(syncAirtable, 5 * 60 * 1000);\nsetTimeout(syncAirtable, 2000);");

fs.writeFileSync('index.js', merged);
console.log('Merged index.js written.');
