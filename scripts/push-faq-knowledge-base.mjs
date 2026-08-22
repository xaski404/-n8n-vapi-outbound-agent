/**
 * Create or refresh Retell Knowledge Base from data/faq-pl.json and attach to inbound LLM.
 * Writes RETELL_KB_ID to .env when a new KB is created.
 *
 *   node scripts/push-faq-knowledge-base.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const faqFile = join(root, 'data', 'faq-pl.json');
const INBOUND_AGENT_ID = 'agent_edfc81cbe141dc83d40217c3b1';
const KB_NAME = 'Studio FAQ PL';

function readDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
}

function upsertEnvVar(path, key, value) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  writeFileSync(path, out.join('\n') + '\n', 'utf8');
}

async function retellFetch(apiKey, path, init = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`https://api.retellai.com${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function ensureEditableDraft(apiKey, agentId) {
  let agent = await retellFetch(apiKey, `/get-agent/${agentId}`);
  const llmId = agent.response_engine?.llm_id;
  if (!llmId) throw new Error('Agent nie używa retell-llm');

  const probe = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (probe.ok) {
    await probe.json().catch(() => {});
    return { agent, llmId };
  }
  const errText = await probe.text();
  if (!errText.includes('Cannot update published LLM')) {
    throw new Error(`/update-retell-llm/${llmId} ${probe.status}: ${errText.slice(0, 200)}`);
  }
  agent = await retellFetch(apiKey, `/create-agent-version/${agentId}`, {
    method: 'POST',
    body: JSON.stringify({ base_version: agent.version }),
  });
  return { agent, llmId: agent.response_engine.llm_id };
}

const env = readDotEnv(envFile);
const apiKey = env.RETELL_API_KEY;
const inboundAgentId = env.RETELL_INBOUND_AGENT_ID || INBOUND_AGENT_ID;
if (!apiKey) {
  console.error('Brak RETELL_API_KEY w .env');
  process.exit(1);
}

const faq = JSON.parse(readFileSync(faqFile, 'utf8'));
const knowledge_base_texts = (faq.entries ?? []).map((entry) => ({
  title: entry.question,
  text: entry.answer,
}));

let kbId = env.RETELL_KB_ID || '';
if (kbId) {
  console.log(`Using existing RETELL_KB_ID=${kbId} (create new KB manually if FAQ changed)`);
} else {
  const form = new FormData();
  form.append('knowledge_base_name', KB_NAME);
  form.append('knowledge_base_texts', JSON.stringify(knowledge_base_texts));

  const res = await fetch('https://api.retellai.com/create-knowledge-base', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create-knowledge-base ${res.status}: ${text.slice(0, 300)}`);
  const created = JSON.parse(text);
  kbId = created.knowledge_base_id;
  upsertEnvVar(envFile, 'RETELL_KB_ID', kbId);
  console.log(`Created KB ${kbId} (${knowledge_base_texts.length} entries)`);
}

const draft = await ensureEditableDraft(apiKey, inboundAgentId);
await retellFetch(apiKey, `/update-retell-llm/${draft.llmId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ knowledge_base_ids: [kbId] }),
});

const agent = await retellFetch(apiKey, `/publish-agent-version/${inboundAgentId}`, {
  method: 'POST',
  body: JSON.stringify({ version: draft.agent.version }),
});
console.log(`attached KB to ${inboundAgentId} -> v${agent.version ?? draft.agent.version}`);
console.log('Gotowe.');
