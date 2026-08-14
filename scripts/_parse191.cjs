const fs = require('fs');
const r = fs.readFileSync('c:/Users/askik/Desktop/n8n_AI_assistant/scripts/_exec191.txt', 'utf8');
for (const k of ['Webhook', 'Map Retell', 'Get Sheet Tab', 'Append', 'Dispatch Retell', 'meta-lead', 'call_analyzed', 'skipped', 'lastNodeExecuted']) {
  const i = r.indexOf(k);
  if (i >= 0) console.log(k + ':', r.slice(i, i + 150));
}
const nodes = r.match(/"Webhook[^"]*":"[^"]*"/g);
console.log('webhook nodes:', nodes?.slice(0,3));
