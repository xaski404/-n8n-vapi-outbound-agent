/**
 * Replay missed Retell call_analyzed webhooks into n8n → Google Sheets.
 * Usage:
 *   node scripts/replay-retell-calls.mjs [limit]
 *   node scripts/replay-retell-calls.mjs 20 --all-agents
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');

function readDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
}

const env = readDotEnv(envFile);
const key = env.RETELL_API_KEY;
const limit = Number(process.argv[2] || 10);
const allAgents = process.argv.includes('--all-agents');
const webhook =
  process.env.REPLAY_WEBHOOK ||
  `${(env.PUBLIC_WEBHOOK_URL || 'http://localhost:5678/').replace(/\/$/, '')}/webhook/retell-call-analyzed`;

if (!key) {
  console.error('Brak RETELL_API_KEY w .env');
  process.exit(1);
}

const filter = allAgents
  ? {}
  : {
      filter_criteria: {
        agent_id: [
          env.RETELL_INBOUND_AGENT_ID || 'agent_edfc81cbe141dc83d40217c3b1',
          env.RETELL_OUTBOUND_AGENT_ID || env.RETELL_AGENT_ID || 'agent_8d93c1c50313f224a2be084d2a',
        ].filter(Boolean),
      },
    };

const listRes = await fetch('https://api.retellai.com/v2/list-calls', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ...filter, sort_order: 'descending', limit }),
});
if (!listRes.ok) throw new Error(`list-calls ${listRes.status}: ${await listRes.text()}`);
const calls = await listRes.json();

console.log(`Replay -> ${webhook} (${calls.length} calls)`);

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
  console.log(`${call.call_id} [${call.direction || '?'}] → HTTP ${res.status} ${body.slice(0, 120)}`);
}
