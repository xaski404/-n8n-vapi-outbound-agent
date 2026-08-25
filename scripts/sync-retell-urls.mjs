/**
 * Sync Retell agent webhooks + calendar tool URLs from PUBLIC_WEBHOOK_URL in .env.
 * Also publishes the latest agent draft and rebinds the studio phone number —
 * otherwise inbound calls can stay pinned to an old agent_version with dead URLs.
 *
 *   node scripts/sync-retell-urls.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOK_APPOINTMENT_TOOL_DESCRIPTION,
  CANCEL_APPOINTMENT_TOOL_DESCRIPTION,
  LIST_MY_APPOINTMENTS_TOOL_DESCRIPTION,
  RESCHEDULE_APPOINTMENT_TOOL_DESCRIPTION,
  calendarTool,
  patchEndCallTool,
} from './retell-inbound-tools.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const INBOUND_AGENT_ID = 'agent_edfc81cbe141dc83d40217c3b1';

function readDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
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
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function patchToolUrls(tools, base) {
  const bookParams = {
    type: 'object',
    properties: {
      slot_start: { type: 'string', description: 'Skopiuj DOKLADNIE pole start z wybranego obiektu slots[] z check_availability — NIE licz ISO z godziny' },
      customer_name: {
        type: 'string',
        description: 'Imię i nazwisko klienta — klient podaje oba w rozmowie.',
      },
      conversation_summary: {
        type: 'string',
        description: 'Krótkie podsumowanie rozmowy. Przy treningu próbnym: cel, doświadczenie, ustalenia. Przy zwykłym umówieniu: dzień, godzina, ewentualne pytania.',
      },
      goal: {
        type: 'string',
        description: 'Cel treningowy — WYMAGANE przy bezpłatnym treningu próbnym, opcjonalnie przy zwykłym umówieniu.',
      },
      experience_level: {
        type: 'string',
        description: 'początkujący / średnio / zaawansowany — WYMAGANE przy treningu próbnym.',
      },
      sessions_per_week: {
        type: 'string',
        description: 'Ile razy w tygodniu — WYMAGANE przy treningu próbnym.',
      },
      notes: { type: 'string', description: 'Dodatkowe notatki (opcjonalnie)' },
    },
    required: ['slot_start', 'customer_name', 'conversation_summary'],
  };

  const cancelParams = {
    type: 'object',
    properties: {
      customer_name: {
        type: 'string',
        description: 'Imię i nazwisko klienta — klient MUSI podać oba w rozmowie (weryfikacja tożsamości). NIE czytaj z systemu.',
      },
      slot_start: {
        type: 'string',
        description: 'Skopiuj DOKŁADNIE pole slot_start z wybranego obiektu appointments[] z list_my_appointments. NIE licz ISO ręcznie.',
      },
      reason: { type: 'string', description: 'Krótki powód odwołania (opcjonalnie).' },
    },
    required: ['customer_name', 'slot_start'],
  };

  const rescheduleParams = {
    type: 'object',
    properties: {
      customer_name: {
        type: 'string',
        description: 'Imię i nazwisko klienta — klient MUSI podać oba w rozmowie (weryfikacja tożsamości). NIE czytaj z systemu.',
      },
      old_slot_start: {
        type: 'string',
        description: 'Stara wizyta — skopiuj DOKŁADNIE pole slot_start z wybranego obiektu appointments[] z list_my_appointments. NIE licz ISO ręcznie.',
      },
      new_slot_start: {
        type: 'string',
        description: 'Nowy termin — skopiuj DOKŁADNIE pole start z wybranego obiektu slots[] z check_availability. NIE licz ISO ręcznie.',
      },
      conversation_summary: {
        type: 'string',
        description: 'Opcjonalnie: krótkie podsumowanie rozmowy (np. z piątku 15 na środę 12).',
      },
    },
    required: ['customer_name', 'old_slot_start', 'new_slot_start'],
  };

  const customDefs = {
    check_availability: calendarTool(
      base,
      'check_availability',
      'Sprawdza wolne terminy. Przy przelozzeniu — dopiero PO list_my_appointments i potwierdzeniu starej wizyty. Gdy klient podal konkretna godzine — podaj preferred_time (np. 12:00); backend zwroci exact_match:true i jeden slot.',
      `${base}/webhook/retell-check-availability`,
      {
        type: 'object',
        properties: {
          preferred_day: { type: 'string', description: 'Preferowany dzien tygodnia po polsku, np. czwartek. Dla piątku za tydzień: kolejny piątek' },
          preferred_date: { type: 'string', description: 'Konkretna data, np. 2026-08-28, 28 sierpnia lub 21' },
          preferred_time: {
            type: 'string',
            description: 'Konkretna godzina gdy klient ja podal, np. 12:00, 15, dwunasta. Backend zwroci exact_match:true i jeden slot — od razu book/reschedule bez wymieniania innych godzin.',
          },
          preferred_time_of_day: {
            type: 'string',
            description:
              'Pora dnia: rano, po_poludniu lub wieczorem (ze underscore). Gdy brak w tej porze, ale są inne godziny tego dnia — backend zwraca same_day_alternatives:true. Najpierw zaproponuj max 2–3 inne godziny TEGO SAMEGO dnia. Gdy klientowi nie pasują — zapytaj jaki inny dzień mu odpowiada. Gdy cały dzień pełny (available:false) — powiedz że tego dnia nie ma terminów i zapytaj o inny dzień.',
          },
        },
      },
      'Moment, sprawdzam kalendarz.',
    ),
    book_appointment: calendarTool(
      base,
      'book_appointment',
      BOOK_APPOINTMENT_TOOL_DESCRIPTION,
      `${base}/webhook/retell-book-appointment`,
      bookParams,
      'Zapisuję termin.',
      { mutating: true },
    ),
    list_my_appointments: calendarTool(
      base,
      'list_my_appointments',
      LIST_MY_APPOINTMENTS_TOOL_DESCRIPTION,
      `${base}/webhook/retell-list-appointments`,
      {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Imie i nazwisko klienta (opcjonalnie, do dopasowania)' },
        },
      },
      'Sprawdzam Twoje wizyty.',
    ),
    cancel_appointment: calendarTool(
      base,
      'cancel_appointment',
      CANCEL_APPOINTMENT_TOOL_DESCRIPTION,
      `${base}/webhook/retell-cancel-appointment`,
      cancelParams,
      'Odwołuję wizytę.',
      { mutating: true },
    ),
    reschedule_appointment: calendarTool(
      base,
      'reschedule_appointment',
      RESCHEDULE_APPOINTMENT_TOOL_DESCRIPTION,
      `${base}/webhook/retell-reschedule-appointment`,
      rescheduleParams,
      'Przekładam termin.',
      { mutating: true },
    ),
  };

  const existing = (tools ?? []).filter((tool) => tool.type === 'custom');
  const names = new Set(existing.map((tool) => tool.name));
  const patched = existing.map((tool) => {
    const def = customDefs[tool.name];
    if (!def) return tool;
    return { ...tool, ...def, parameters: def.parameters ?? tool.parameters };
  });

  for (const name of Object.keys(customDefs)) {
    if (!names.has(name)) patched.push(customDefs[name]);
  }

  const nonCustom = (tools ?? []).filter((tool) => tool.type !== 'custom');
  return patchEndCallTool([...nonCustom, ...patched]);
}

const postCallAnalysisData = [
  {
    type: 'enum',
    name: 'outcome',
    description: 'Wynik rozmowy dla CRM (Google Sheets)',
    choices: [
      'zainteresowany',
      'umówiono',
      'odwołanie',
      'przełożono',
      'niezainteresowany',
      'brak odpowiedzi',
    ],
    required: false,
  },
  {
    type: 'string',
    name: 'customer_name',
    description: 'Imię i nazwisko klienta potwierdzone w rozmowie',
    required: false,
  },
  {
    type: 'string',
    name: 'sessions_per_week',
    description: 'Ile razy w tygodniu klient chce trenować',
    required: false,
  },
  {
    type: 'string',
    name: 'preferred_session_date',
    description: 'Preferowany termin (dzień tygodnia i godzina po polsku, np. piątek o 11)',
    required: false,
  },
  {
    type: 'string',
    name: 'booked_slot',
    description: 'Potwierdzony zarezerwowany termin treningu po book_appointment',
    required: false,
  },
  {
    type: 'string',
    name: 'goal',
    description: 'Cel treningowy klienta',
    required: false,
  },
  {
    type: 'string',
    name: 'experience_level',
    description: 'początkujący / średnio / zaawansowany',
    required: false,
  },
];

async function ensureEditableDraft(apiKey, agentId) {
  let agent = await retellFetch(apiKey, `/get-agent/${agentId}`);
  const llmId = agent.response_engine?.llm_id;
  if (!llmId) return null;

  const llm = await retellFetch(apiKey, `/get-retell-llm/${llmId}`);
  const patchBody = JSON.stringify({ general_tools: llm.general_tools });

  const probe = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: patchBody,
  });

  if (probe.ok) {
    await probe.json();
    return { agent, llmId, llm };
  }

  const errText = await probe.text();
  if (!errText.includes('Cannot update published LLM')) {
    throw new Error(`/update-retell-llm/${llmId} ${probe.status}: ${errText.slice(0, 200)}`);
  }

  agent = await retellFetch(apiKey, `/create-agent-version/${agentId}`, {
    method: 'POST',
    body: JSON.stringify({ base_version: agent.version }),
  });
  const nextLlmId = agent.response_engine.llm_id;
  const nextLlm = await retellFetch(apiKey, `/get-retell-llm/${nextLlmId}`);
  return { agent, llmId: nextLlmId, llm: nextLlm };
}

async function syncAgent(apiKey, agentId, base) {
  const draft = await ensureEditableDraft(apiKey, agentId);
  if (!draft) {
    console.log(`skip ${agentId} (no retell-llm)`);
    return null;
  }

  await retellFetch(apiKey, `/update-retell-llm/${draft.llmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ general_tools: patchToolUrls(draft.llm.general_tools, base) }),
  });

  const agent = await retellFetch(apiKey, `/update-agent/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      webhook_url: `${base}/webhook/retell-call-analyzed`,
      post_call_analysis_data: postCallAnalysisData,
      end_call_after_silence_ms: 45_000,
    }),
  });

  await retellFetch(apiKey, `/publish-agent-version/${agentId}`, {
    method: 'POST',
    body: JSON.stringify({ version: agent.version }),
  });

  console.log(`synced ${agent.agent_name ?? agentId} -> v${agent.version}`);
  return { agentId, version: agent.version };
}

const env = readDotEnv(envFile);
const apiKey = env.RETELL_API_KEY;
const base = (env.PUBLIC_WEBHOOK_URL ?? '').replace(/\/$/, '');
const phone = env.RETELL_FROM_NUMBER;
const inboundAgentId = env.RETELL_INBOUND_AGENT_ID || INBOUND_AGENT_ID;
const outboundAgentId = env.RETELL_OUTBOUND_AGENT_ID || env.RETELL_AGENT_ID;

if (!apiKey) {
  console.error('Brak RETELL_API_KEY w .env');
  process.exit(1);
}
if (!base) {
  console.error('Brak PUBLIC_WEBHOOK_URL w .env');
  process.exit(1);
}

const agentIds = [inboundAgentId, outboundAgentId, env.RETELL_AGENT_ID].filter(Boolean);
const unique = [...new Set(agentIds)];

const published = [];
for (const agentId of unique) {
  const result = await syncAgent(apiKey, agentId, base);
  if (result) published.push(result);
}

if (phone) {
  const inbound = published.find((p) => p.agentId === inboundAgentId) ?? published[0];
  const outbound = published.find((p) => p.agentId === outboundAgentId) ?? published[published.length - 1];
  if (inbound && outbound) {
    await retellFetch(apiKey, `/update-phone-number/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        inbound_agents: [{ agent_id: inbound.agentId, agent_version: inbound.version, weight: 1 }],
        outbound_agents: [{ agent_id: outbound.agentId, agent_version: outbound.version, weight: 1 }],
      }),
    });
    console.log(`phone ${phone} -> inbound v${inbound.version}, outbound v${outbound.version}`);
  }
}

console.log(`Retell URLs -> ${base}`);
