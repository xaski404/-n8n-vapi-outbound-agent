/**
 * Push the inbound agent prompt + welcome message + speech settings to Retell.
 * Reads the system prompt from docs/retell-agent-prompt.md (first fenced block
 * after "## Prompt systemowy") and the welcome message (first fenced block after
 * "## Welcome Message"). Creates a new agent version if the LLM is published,
 * updates it, publishes, and rebinds the studio phone (inbound only).
 *
 *   node scripts/push-inbound-prompt.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchEndCallTool } from './retell-inbound-tools.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const docFile = join(root, 'docs', 'retell-agent-prompt.md');
// Agent ID from .env — no hardcoded fallback

// Baseline: agent v74 (prod) — Grace, spokojniejsze tempo, mniej agresywne przerywanie
const RESPONSIVENESS = 0.55;
const INTERRUPTION_SENSITIVITY = 0.15;
const VOICE_TEMPERATURE = 0.6;
const VOICE_SPEED = 0.92;
const DEFAULT_VOICE_ID = '11labs-Grace';
const MAX_CALL_DURATION_MS = 600_000; // 10 min — umówienie + przełożenie + FAQ w jednej rozmowie
const END_CALL_AFTER_SILENCE_MS = 45_000;

function readDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
}

function extractFencedBlockAfter(md, heading) {
  const idx = md.indexOf(heading);
  if (idx === -1) throw new Error(`Nie znaleziono nagłówka: ${heading}`);
  const rest = md.slice(idx + heading.length);
  const open = rest.indexOf('```');
  if (open === -1) throw new Error(`Brak bloku \`\`\` po: ${heading}`);
  const afterOpen = rest.indexOf('\n', open) + 1;
  const close = rest.indexOf('```', afterOpen);
  if (close === -1) throw new Error(`Niedomknięty blok \`\`\` po: ${heading}`);
  return rest.slice(afterOpen, close).trim();
}

async function retellFetch(apiKey, path, init = {}) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
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
const phone = env.RETELL_FROM_NUMBER;
const inboundAgentId = env.RETELL_INBOUND_AGENT_ID;
if (!inboundAgentId) {
  console.error('Brak RETELL_INBOUND_AGENT_ID w .env');
  process.exit(1);
}
if (!apiKey) {
  console.error('Brak RETELL_API_KEY w .env');
  process.exit(1);
}

const md = readFileSync(docFile, 'utf8');
const prompt = extractFencedBlockAfter(md, '## Prompt systemowy');
const welcome = extractFencedBlockAfter(md, '## Welcome Message');
console.log(`prompt: ${prompt.length} znaków, welcome: "${welcome}"`);

const draft = await ensureEditableDraft(apiKey, inboundAgentId);
const llm = await retellFetch(apiKey, `/get-retell-llm/${draft.llmId}`);

await retellFetch(apiKey, `/update-retell-llm/${draft.llmId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    general_prompt: prompt,
    begin_message: welcome,
    start_speaker: 'agent',
    general_tools: patchEndCallTool(llm.general_tools),
    ...(env.RETELL_KB_ID ? { knowledge_base_ids: [env.RETELL_KB_ID] } : {}),
  }),
});

const agent = await retellFetch(apiKey, `/update-agent/${inboundAgentId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    language: 'pl-PL',
    responsiveness: RESPONSIVENESS,
    interruption_sensitivity: INTERRUPTION_SENSITIVITY,
    voice_temperature: VOICE_TEMPERATURE,
    voice_speed: VOICE_SPEED,
    enable_expressive_mode: false,
    max_call_duration_ms: MAX_CALL_DURATION_MS,
    end_call_after_silence_ms: END_CALL_AFTER_SILENCE_MS,
    voice_id: env.RETELL_INBOUND_VOICE_ID || DEFAULT_VOICE_ID,
  }),
});

await retellFetch(apiKey, `/publish-agent-version/${inboundAgentId}`, {
  method: 'POST',
  body: JSON.stringify({ version: agent.version }),
});
console.log(`published ${agent.agent_name ?? inboundAgentId} -> v${agent.version}`);

if (phone) {
  const current = await retellFetch(apiKey, `/get-phone-number/${encodeURIComponent(phone)}`);
  const body = {
    inbound_agents: [{ agent_id: inboundAgentId, agent_version: agent.version, weight: 1 }],
  };
  if (current.outbound_agents?.length) body.outbound_agents = current.outbound_agents;
  await retellFetch(apiKey, `/update-phone-number/${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  console.log(`phone ${phone} -> inbound v${agent.version} (outbound bez zmian)`);
}

console.log('Gotowe.');
