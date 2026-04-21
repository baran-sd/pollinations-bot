const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'index.js');
const c = fs.readFileSync(filePath, 'utf8');
const lines = c.split('\n');

// Find the broken line 162 (0-indexed: 161) - the garbled console.log inside dns.lookup
// It should be:
//   console.log(`[DNS Hijack] Redirecting api.telegram.org -> 149.154.167.220`);
//   return callback(null, [{ address: '149.154.167.220', family: 4 }], 4);
// Then close the if-block and dns.lookup function, then the try/setServers block starts.

// Current state (0-indexed):
// 161: broken console.log line (missing backticks, bleeds into next)
// 162: "try {" -- this should come AFTER dns.lookup closes

// Step 1: Fix line at index 161
lines[161] = "    console.log('[DNS Hijack] Redirecting api.telegram.org -> 149.154.167.220');\r";

// Step 2: Insert missing closing lines for dns.lookup right after index 161
const insertLines = [
  "    return callback(null, [{ address: '149.154.167.220', family: 4 }], 4);\r",
  "  }\r",
  "  return originalLookup(hostname, options, callback);\r",
  "};\r",
  "\r",
];
lines.splice(162, 0, ...insertLines);

const result = lines.join('\n');
fs.writeFileSync(filePath, result, 'utf8');
console.log('Fix applied. Total lines:', result.split('\n').length);

// Verify the section
const verify = result.split('\n').slice(154, 205);
verify.forEach((l, i) => console.log((155 + i) + ':', JSON.stringify(l).substring(0, 100)));
