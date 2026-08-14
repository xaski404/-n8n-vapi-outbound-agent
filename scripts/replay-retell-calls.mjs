/**
 * Replay missed Retell call_analyzed webhooks into local n8n → Google Sheets.
 * Usage: node scripts/replay-retell-calls.mjs [limit]
 */
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const key = process.env.RETELL_API_KEY || 'key_37ca776f09a9ea370daca37d43dc';
const agentId = process.env.RETELL_AGENT_ID || 'agent_8d93c1c50313f224a2be084d2a';
const limit = Number(process.argv[2] || 5);
const webhook = process.env.REPLAY_WEBHOOK || 'http://localhost:5678/webhook/retell-call-analyzed';

const listRes = await fetch('https://api.retellai.com/v2/list-calls', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    filter_criteria: { agent_id: [agentId] },
    limit,
  }),
});
if (!listRes.ok) throw new Error(`list-calls ${listRes.status}: ${await listRes.text()}`);
const calls = await listRes.json();

for (const call of calls) {
  if (!call.call_analysis) {
    console.log('skip (no analysis yet):', call.call_id);
    continue;
  }
  const payload = { event: 'call_analyzed', call };
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`${call.call_id} → HTTP ${res.status} ${body.slice(0, 120)}`);
}
