const fs = require('fs');
const raw = fs.readFileSync('c:/Users/askik/Desktop/n8n_AI_assistant/scripts/_exec170.txt', 'utf8');
const m = raw.match(/1popmUi[A-Za-z0-9_-]{20,}/g);
console.log('170:', [...new Set(m || [])]);
const raw2 = fs.readFileSync('c:/Users/askik/Desktop/n8n_AI_assistant/scripts/_exec188.txt', 'utf8');
const m2 = raw2.match(/1popmUi[A-Za-z0-9_-]{20,}/g);
console.log('188:', [...new Set(m2 || [])]);
