/**
 * n8n Code node #2 — "Map Vapi → Google Sheets"
 * Runs after the Vapi end-of-call-report webhook. Extracts transcript,
 * summary, structured data and dispatch-time variables, then produces a
 * flat row for append-or-update in Google Sheets (match on `phone`).
 */

import type {
  VapiEndOfCallReport,
  VapiStructuredData,
  VoiceLeadSheetRow,
} from './types';

/** Map Vapi's structured outcome onto a human-readable CRM status. */
function outcomeToStatus(outcome?: string): VoiceLeadSheetRow['status'] {
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

export function mapVapiToSheets(items: N8nItem[]): Array<{ json: Record<string, unknown> }> {
  return items.map((item) => {
    const root = (item.json.body ?? item.json) as VapiEndOfCallReport;
    const msg = root.message ?? ({} as VapiEndOfCallReport['message']);

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
    const recordingUrl =
      msg.artifact?.presignedMonoUrl ??
      msg.artifact?.presignedStereoUrl ??
      msg.artifact?.recordingUrl ??
      '';

    const sheet: VoiceLeadSheetRow = {
      phone,
      full_name: fullName,
      first_name: first,
      last_name: last,
      campaign: (vars.campaign_name as string) ?? 'Unknown',
      status: outcomeToStatus(structured.outcome),
      call_outcome: structured.outcome ?? msg.endedReason ?? 'unknown',
      call_summary: summary,
      recording_url: recordingUrl,
      vapi_call_id: msg.call?.id ?? '',
      transcript,
      budget: structured.budget != null ? String(structured.budget) : '',
      sessions_per_week:
        structured.sessions_per_week != null ? String(structured.sessions_per_week) : '',
    preferred_session_date:
      structured.preferred_session_date != null
        ? String(structured.preferred_session_date)
        : '',
    ended_reason: msg.endedReason ?? '',
  };

    return {
      json: {
        skipped: false,
        sheet,
        upsertKey: phone,
        structured,
        endedReason: msg.endedReason ?? null,
        durationSeconds: msg.durationSeconds ?? null,
      },
    };
  });
}
