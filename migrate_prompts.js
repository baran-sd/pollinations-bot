require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const token = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
  const baseId = (process.env.AIRTABLE_BASE_ID || '').match(/(app[a-zA-Z0-9]+)/)?.[1];
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Prompts';

  if (!token || !baseId) {
    console.error('❌ Error: AIRTABLE_PERSONAL_ACCESS_TOKEN and AIRTABLE_BASE_ID must be set in .env');
    process.exit(1);
  }

  const promptsPath = path.join(__dirname, 'prompts.json');
  if (!fs.existsSync(promptsPath)) {
    console.error('❌ Error: prompts.json not found');
    process.exit(1);
  }

  const { global: prompts } = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
  console.log(`📂 Found ${prompts.length} prompts in prompts.json`);

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;

  for (const p of prompts) {
    try {
      console.log(`📤 Migrating: ${p.name}...`);
      await axios.post(url, {
        records: [{
          fields: {
            "Name": p.name.replace(/[^\w\s\u0400-\u04FF]/g, '').trim(), // Cleanup emojis just in case
            "SystemPrompt": p.text
          }
        }]
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`✅ Success: ${p.name}`);
    } catch (err) {
      console.error(`❌ Failed: ${p.name} - ${err.response?.data?.error?.message || err.message}`);
    }
  }

  console.log('🏁 Migration finished.');
}

migrate();
