const fs = require('fs');
for (const f of ['_exec170.txt', '_exec188.txt']) {
  const raw = fs.readFileSync(`c:/Users/askik/Desktop/n8n_AI_assistant/scripts/${f}`, 'utf8');
  const ids = [...new Set(raw.match(/spreadsheets\/[A-Za-z0-9_-]+/g) || [])];
  const err = raw.match(/Unable to parse range[^"]*|Requested entity was not found[^"]*|404 - \{[^}]+\}/);
  console.log(f, 'ids:', ids, 'err:', err?.[0]?.slice(0, 120));
}
