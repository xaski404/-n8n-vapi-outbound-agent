import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

export const N8N_BASE_URL = (process.env.N8N_BASE_URL ?? 'http://localhost:5678').replace(/\/$/, '');

export async function isN8nHealthy(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${N8N_BASE_URL}/healthz`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function postWebhook(path, body) {
  const response = await fetch(`${N8N_BASE_URL}/webhook/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text };
    }
  }

  return { status: response.status, json, text };
}

export function loadFixture(name) {
  const filePath = join(root, 'scripts', name);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function uniqueE164(prefix = '+48100') {
  const suffix = String(Date.now()).slice(-6);
  return `${prefix}${suffix}`;
}

export function buildRetellCallAnalyzedPayload(overrides = {}) {
  const phone = overrides.phone ?? uniqueE164();
  const callId = overrides.callId ?? `e2e-${Date.now()}`;

  return {
    event: 'call_analyzed',
    call: {
      call_type: 'phone_call',
      call_id: callId,
      agent_id: 'agent_e2e',
      direction: 'outbound',
      from_number: '+48324412887',
      to_number: phone,
      disconnection_reason: 'user_hangup',
      transcript: 'Agent: Dzień dobry.\nUser: tak, interesuje mnie trening',
      recording_url: '',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E Test Lead',
        phone_number: phone,
        campaign_name: 'e2e-test',
      },
      call_analysis: {
        call_summary: 'E2E — zainteresowany darmowym treningiem',
        in_voicemail: false,
        custom_analysis_data: {
          outcome: 'zainteresowany',
          sessions_per_week: '2',
          preferred_session_date: 'czwartek o osmej',
          ...(overrides.customAnalysis ?? {}),
        },
      },
      ...(overrides.call ?? {}),
    },
    ...overrides.root,
  };
}

export function buildMetaLeadPayload(overrides = {}) {
  const phone = overrides.phone ?? uniqueE164('+48222');
  return {
    full_name: overrides.fullName ?? 'E2E Meta Lead',
    phone_number: phone,
    campaign_name: overrides.campaignName ?? 'e2e-test',
    leadgen_id: overrides.leadgenId ?? `lg_e2e_${Date.now()}`,
  };
}
