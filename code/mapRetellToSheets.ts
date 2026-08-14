/**
 * n8n Code node — "Map Retell → Google Sheets"
 * Runs after Retell `call_analyzed` webhook. Extracts transcript, summary,
 * post-call analysis and dispatch-time dynamic variables into a sheet row.
 */

import type { RetellCallAnalyzedWebhook, VoiceLeadSheetRow, VoiceLeadStatus } from './types';

/** Polish spoken hour → digit, for sheet storage (agent speaks "o ósmej", sheet gets "o 8"). */
const HOUR_WORD_TO_DIGIT: ReadonlyArray<[string, string]> = [
  ['dwudziestej', '20'],
  ['dziewiętnastej', '19'],
  ['osiemnastej', '18'],
  ['siedemnastej', '17'],
  ['szesnastej', '16'],
  ['piętnastej', '15'],
  ['czternastej', '14'],
  ['trzynastej', '13'],
  ['dwunastej', '12'],
  ['jedenastej', '11'],
  ['dziesiątej', '10'],
  ['dziewiątej', '9'],
  ['siódmej', '7'],
  ['szóstej', '6'],
  ['piątej', '5'],
  ['czwartej', '4'],
  ['trzeciej', '3'],
  ['drugiej', '2'],
  ['pierwszej', '1'],
  ['ósmej', '8'],
];

function normalizePreferredSessionDate(value: string): string {
  let result = value.trim();
  if (!result) return result;

  result = result.replace(/wpół do szesnastej/gi, 'o 15:30');
  result = result.replace(/piętnasta trzydzieści/gi, 'o 15:30');

  for (const [word, digit] of HOUR_WORD_TO_DIGIT) {
    const pattern = new RegExp(`o\\s+${word}`, 'gi');
    result = result.replace(pattern, `o ${digit}`);
  }

  return result.replace(/\s+/g, ' ').trim();
}

function outcomeToStatus(
  outcome?: string,
  callSuccessful?: boolean,
  preferredSessionDate?: string,
): VoiceLeadStatus {
  switch ((outcome ?? '').toLowerCase().trim()) {
    case 'interested':
    case 'zainteresowany':
      return 'zainteresowany';
    case 'not_interested':
    case 'niezainteresowany':
      return 'niezainteresowany';
    case 'callback':
    case 'nieodebrane':
    case 'no_answer':
    case 'voicemail':
      return 'brak odpowiedzi';
    default:
      if (callSuccessful && preferredSessionDate) return 'zainteresowany';
      return 'brak odpowiedzi';
  }
}

interface N8nItem {
  json: Record<string, unknown> & { body?: RetellCallAnalyzedWebhook };
}

export function mapRetellToSheets(items: N8nItem[]): Array<{ json: Record<string, unknown> }> {
  return items.map((item) => {
    const root = (item.json.body ?? item.json) as RetellCallAnalyzedWebhook;
    const event = root.event ?? '';

    if (event !== 'call_analyzed') {
      return { json: { skipped: true, reason: `Ignored event: ${event || 'unknown'}` } };
    }

    const call = root.call ?? {};
    const vars = (call.retell_llm_dynamic_variables ?? {}) as Record<string, string>;
    const analysis = call.call_analysis ?? {};
    const custom = (analysis.custom_analysis_data ?? {}) as Record<string, unknown>;

    const phone =
      (call.direction === 'outbound' ? call.to_number : call.from_number) ??
      vars.phone_number ??
      '';

    const fullName = vars.full_name || String(custom.notes ?? '') || 'Nieznany kontakt';

    const preferredSessionDate = normalizePreferredSessionDate(
      custom.preferred_session_date != null
        ? String(custom.preferred_session_date)
        : '',
    );

    const sheet: VoiceLeadSheetRow = {
      phone,
      full_name: fullName,
      status: outcomeToStatus(
        String(custom.outcome ?? ''),
        analysis.call_successful,
        preferredSessionDate,
      ),
      call_summary: analysis.call_summary ?? '',
      recording_url: call.recording_url ?? '',
      transcript: call.transcript ?? '',
      sessions_per_week:
        custom.sessions_per_week != null ? String(custom.sessions_per_week) : '',
      preferred_session_date: preferredSessionDate,
    };

    return {
      json: {
        skipped: false,
        sheet,
        upsertKey: phone,
        retellCallId: call.call_id ?? null,
        disconnectionReason: call.disconnection_reason ?? null,
      },
    };
  });
}
