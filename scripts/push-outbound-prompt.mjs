/**
 * Push the outbound agent prompt + welcome message + speech settings to Retell.
 * Reads from docs/retell-outbound-agent-prompt.md (fenced blocks after
 * "## Welcome Message" and "## Prompt systemowy"). Creates a new agent version
 * if the LLM is published, updates it, publishes, and rebinds the studio phone
 * (outbound only).
 *
 *   node scripts/push-outbound-prompt.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const docFile = join(root, 'docs', 'retell-outbound-agent-prompt.md');
const OUTBOUND_AGENT_ID = 'agent_8d93c1c50313f224a2be084d2a';

const RESPONSIVENESS = 0.8;
const INTERRUPTION_SENSITIVITY = 0.5;

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
const outboundAgentId =
  env.RETELL_OUTBOUND_AGENT_ID || env.RETELL_AGENT_ID || OUTBOUND_AGENT_ID;

if (!apiKey) {
  console.error('Brak RETELL_API_KEY w .env');
  process.exit(1);
}

const md = readFileSync(docFile, 'utf8');
const prompt = extractFencedBlockAfter(md, '## Prompt systemowy');
const welcome = extractFencedBlockAfter(md, '## Welcome Message');
console.log(`prompt: ${prompt.length} znaków, welcome: "${welcome.slice(0, 80)}..."`);

const draft = await ensureEditableDraft(apiKey, outboundAgentId);

await retellFetch(apiKey, `/update-retell-llm/${draft.llmId}`, {
  method: 'PATCH',
  body: JSON.stringify({ general_prompt: prompt, begin_message: welcome }),
});

const agent = await retellFetch(apiKey, `/update-agent/${outboundAgentId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    responsiveness: RESPONSIVENESS,
    interruption_sensitivity: INTERRUPTION_SENSITIVITY,
  }),
});

await retellFetch(apiKey, `/publish-agent-version/${outboundAgentId}`, {
  method: 'POST',
  body: JSON.stringify({ version: agent.version }),
});
console.log(`published ${agent.agent_name ?? outboundAgentId} -> v${agent.version}`);

if (phone) {
  const current = await retellFetch(apiKey, `/get-phone-number/${encodeURIComponent(phone)}`);
  const body = {
    outbound_agents: [{ agent_id: outboundAgentId, agent_version: agent.version, weight: 1 }],
  };
  if (current.inbound_agents?.length) body.inbound_agents = current.inbound_agents;
  await retellFetch(apiKey, `/update-phone-number/${encodeURIComponent(phone)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  console.log(`phone ${phone} -> outbound v${agent.version} (inbound bez zmian)`);
}

console.log('Gotowe.');
