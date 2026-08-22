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

export function buildRetellCheckAvailabilityPayload(overrides = {}) {
  return {
    name: 'check_availability',
    args: {
      preferred_day: overrides.preferredDay ?? 'czwartek',
      ...(overrides.args ?? {}),
    },
    call: {
      call_id: overrides.callId ?? `e2e-avail-${Date.now()}`,
      direction: 'inbound',
      from_number: overrides.phone ?? '+48100999888',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E Availability Test',
      },
      ...(overrides.call ?? {}),
    },
  };
}

export function buildRetellBookAppointmentPayload(overrides = {}) {
  const slotStart =
    overrides.slotStart ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(10, 0, 0, 0);
      return d.toISOString();
    })();

  return {
    name: 'book_appointment',
    args: {
      slot_start: slotStart,
      customer_name: overrides.fullName ?? 'E2E Booking Test',
      notes: overrides.notes ?? 'E2E test booking',
      ...(overrides.args ?? {}),
    },
    call: {
      call_id: overrides.callId ?? `e2e-book-${Date.now()}`,
      direction: 'inbound',
      from_number: overrides.phone ?? '+48100999888',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E Booking Test',
        phone_number: overrides.phone ?? '+48100999888',
      },
      ...(overrides.call ?? {}),
    },
  };
}

export function buildRetellListAppointmentsPayload(overrides = {}) {
  return {
    name: 'list_my_appointments',
    args: {
      customer_name: overrides.fullName ?? 'E2E List Test',
      ...(overrides.args ?? {}),
    },
    call: {
      call_id: overrides.callId ?? `e2e-list-${Date.now()}`,
      direction: 'inbound',
      from_number: overrides.phone ?? '+48100999888',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E List Test',
        phone_number: overrides.phone ?? '+48100999888',
      },
      ...(overrides.call ?? {}),
    },
  };
}

export function buildRetellCancelAppointmentPayload(overrides = {}) {
  const slotStart =
    overrides.slotStart ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(10, 0, 0, 0);
      return d.toISOString();
    })();

  return {
    name: 'cancel_appointment',
    args: {
      slot_start: slotStart,
      customer_name: overrides.fullName ?? 'E2E Cancel Test',
      ...(overrides.args ?? {}),
    },
    call: {
      call_id: overrides.callId ?? `e2e-cancel-${Date.now()}`,
      direction: 'inbound',
      from_number: overrides.phone ?? '+48100999888',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E Cancel Test',
        phone_number: overrides.phone ?? '+48100999888',
      },
      ...(overrides.call ?? {}),
    },
  };
}

export function buildRetellRescheduleAppointmentPayload(overrides = {}) {
  return {
    name: 'reschedule_appointment',
    args: {
      old_slot_start: overrides.oldSlotStart,
      new_slot_start: overrides.newSlotStart,
      customer_name: overrides.fullName ?? 'E2E Reschedule Test',
      conversation_summary: overrides.conversationSummary ?? 'E2E reschedule test',
      ...(overrides.args ?? {}),
    },
    call: {
      call_id: overrides.callId ?? `e2e-resched-${Date.now()}`,
      direction: 'inbound',
      from_number: overrides.phone ?? '+48100999888',
      retell_llm_dynamic_variables: {
        full_name: overrides.fullName ?? 'E2E Reschedule Test',
        phone_number: overrides.phone ?? '+48100999888',
      },
      ...(overrides.call ?? {}),
    },
  };
}

export function buildRetellInboundCallAnalyzedPayload(overrides = {}) {
  return buildRetellCallAnalyzedPayload({
    ...overrides,
    call: {
      direction: 'inbound',
      from_number: overrides.phone ?? uniqueE164('+48333'),
      to_number: '+48324412887',
      metadata: { source: 'inbound_call' },
      ...(overrides.call ?? {}),
    },
  });
}
