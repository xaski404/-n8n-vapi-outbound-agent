/**
 * n8n Code node #2  —  "Map Vapi -> Frappe"
 * Runs after the Vapi end-of-call-report webhook. Extracts transcript,
 * summary, structured (function-calling) data and the variables we injected
 * at dispatch time, then produces a Frappe `Lead` upsert payload.
 */

import type {
  VapiEndOfCallReport,
  VapiStructuredData,
  FrappeLeadUpsert,
} from './types';

/** Map Vapi's structured outcome onto a valid ERPNext Lead status. */
function outcomeToStatus(outcome?: string): FrappeLeadUpsert['status'] {
  switch ((outcome ?? '').toLowerCase()) {
    case 'interested':
      return 'Interested';
    case 'callback':
      return 'Replied';
    case 'not_interested':
      return 'Do Not Contact';
    case 'no_answer':
    case 'voicemail':
      return 'Open';
    default:
      return 'Lead';
  }
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? 'Unknown', last: parts[1] ?? '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

interface N8nItem {
  json: Record<string, unknown> & { body?: VapiEndOfCallReport };
}

export function mapVapiToFrappe(items: N8nItem[]): Array<{ json: Record<string, unknown> }> {
  return items.map((item) => {
  const root = (item.json.body ?? item.json) as VapiEndOfCallReport;
  const msg = root.message ?? ({} as VapiEndOfCallReport['message']);

  // Guard: only process the terminal report event.
  if (msg.type && msg.type !== 'end-of-call-report') {
    return { json: { skipped: true, reason: `Ignored event: ${msg.type}` } };
  }

  const vars = (msg.call?.assistantOverrides?.variableValues ?? {}) as Record<string, unknown>;
  const structured: VapiStructuredData = msg.analysis?.structuredData ?? {};

  const phone =
    msg.call?.customer?.number ??
    msg.customer?.number ??
    (vars.phone_number as string) ??
    '';

  const fullName = (vars.full_name as string) ?? (structured.notes as string) ?? 'Unknown Lead';
  const { first, last } = splitName(fullName);

  const summary = msg.analysis?.summary ?? msg.summary ?? (structured.notes as string) ?? '';
  const transcript = msg.artifact?.transcript ?? msg.transcript ?? '';
  // recordingUrl lacks auth token; presignedMonoUrl is the playable link.
  const recordingUrl =
    msg.artifact?.presignedMonoUrl ??
    msg.artifact?.presignedStereoUrl ??
    msg.artifact?.recordingUrl ??
    '';

  const payload: FrappeLeadUpsert = {
    lead_name: fullName,
    first_name: first,
    last_name: last,
    mobile_no: phone,
    phone,
    source: 'Campaign',
    custom_campaign: (vars.campaign_name as string) ?? 'Unknown',
    status: outcomeToStatus(structured.outcome),
    custom_call_outcome: structured.outcome ?? msg.endedReason ?? 'unknown',
    custom_call_summary: summary,
    custom_call_recording_url: recordingUrl,
    custom_vapi_call_id: msg.call?.id ?? '',
    notes: transcript ? [{ note: `Vapi transcript:\n${transcript}` }] : undefined,
  };

  // Deterministic key used by the HTTP node to upsert (filter by mobile_no).
  return {
    json: {
      frappe: payload,
      upsertKey: phone,
      structured,
      endedReason: msg.endedReason ?? null,
      durationSeconds: msg.durationSeconds ?? null,
    },
  };
  });
}
