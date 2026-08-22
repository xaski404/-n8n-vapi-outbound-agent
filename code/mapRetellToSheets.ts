/**
 * n8n Code node — "Map Retell → Google Sheets"
 * Runs after Retell `call_analyzed` webhook. Extracts transcript, summary,
 * post-call analysis and dispatch-time dynamic variables into a sheet row.
 */

import type {
  CallDirection,
  LeadSource,
  RetellCallAnalyzedWebhook,
  VoiceLeadSheetRow,
  VoiceLeadStatus,
} from './types';
import { normalizeSheetPhone } from './sheetColumns';

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

const EN_MONTH_TO_PL: Record<string, string> = {
  january: 'stycznia',
  february: 'lutego',
  march: 'marca',
  april: 'kwietnia',
  may: 'maja',
  june: 'czerwca',
  july: 'lipca',
  august: 'sierpnia',
  september: 'września',
  october: 'października',
  november: 'listopada',
  december: 'grudnia',
};

const EN_WEEKDAY_TO_PL: Record<string, string> = {
  monday: 'poniedziałek',
  tuesday: 'wtorek',
  wednesday: 'środa',
  thursday: 'czwartek',
  friday: 'piątek',
  saturday: 'sobota',
  sunday: 'niedziela',
};

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

function formatEnglishSummaryDate(summary: string): string {
  const match = summary.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?)?/i,
  );
  if (!match) return '';

  const weekday = EN_WEEKDAY_TO_PL[match[1].toLowerCase()] ?? match[1].toLowerCase();
  const month = EN_MONTH_TO_PL[match[2].toLowerCase()] ?? match[2].toLowerCase();
  const day = match[3];
  let hour = match[4] ? parseInt(match[4], 10) : null;
  const minute = match[5] ?? '00';
  const ampm = match[6]?.toUpperCase();

  if (hour != null && ampm === 'PM' && hour < 12) hour += 12;
  if (hour != null && ampm === 'AM' && hour === 12) hour = 0;

  if (hour != null) {
    return `${weekday}, ${day} ${month} ${String(hour).padStart(2, '0')}:${minute}`;
  }
  return `${weekday}, ${day} ${month}`;
}

function inferFromSummary(summary: string): {
  status?: VoiceLeadStatus;
  name?: string;
  term?: string;
} {
  const text = summary.trim();
  if (!text) return {};

  const lower = text.toLowerCase();
  const result: { status?: VoiceLeadStatus; name?: string; term?: string } = {};

  const nameMatch =
    text.match(
      /\b(?:for|dla|klienta?|customer|user|użytkownik(?:a)?)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)/,
    ) ??
    text.match(
      /\b([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)\s+(?:booked|umówił|zapisał)/i,
    );
  if (nameMatch) result.name = nameMatch[1].trim();

  if (
    /\b(cancelled|canceled|odwoła|anulowa|odwołan)/i.test(lower) ||
    /\b(cancel|odwoł).*?(appointment|trening|wizyt|termin)/i.test(lower)
  ) {
    result.status = 'odwołanie';
  } else if (/\b(reschedul|przeło|przesun)/i.test(lower)) {
    result.status = 'przełożono';
  } else if (
    /\b(book|schedul|umów|zapis|potwierdz).*?(appointment|trening|wizyt|termin|session)/i.test(
      lower,
    ) ||
    /\b(appointment|trening|wizyt|session).*?(book|schedul|umów|confirm)/i.test(lower)
  ) {
    result.status = 'umówiono';
  }

  result.term = formatEnglishSummaryDate(text);
  return result;
}

function isNoAnswerDisconnection(reason?: string): boolean {
  const r = (reason ?? '').toLowerCase();
  return (
    r.includes('no_answer') ||
    r.includes('dial_no_answer') ||
    r.includes('voicemail') ||
    r.includes('machine') ||
    r.includes('busy')
  );
}

function outcomeToStatus(
  outcome?: string,
  callSuccessful?: boolean,
  preferredSessionDate?: string,
  bookedSlot?: string,
  disconnectionReason?: string,
  inVoicemail?: boolean,
  hasTranscript?: boolean,
  summaryHint?: VoiceLeadStatus,
): VoiceLeadStatus {
  const o = (outcome ?? '').toLowerCase().trim();

  switch (o) {
    case 'interested':
    case 'zainteresowany':
    case 'pytanie':
      return 'zainteresowany';
    case 'umówiono':
    case 'umowiono':
      return 'umówiono';
    case 'odwołanie':
    case 'odwolanie':
      return 'odwołanie';
    case 'przełożono':
    case 'przelozono':
      return 'przełożono';
    case 'not_interested':
    case 'niezainteresowany':
      return 'niezainteresowany';
    case 'callback':
    case 'nieodebrane':
    case 'no_answer':
    case 'voicemail':
      return 'brak odpowiedzi';
    default:
      break;
  }

  if (summaryHint) return summaryHint;

  if (inVoicemail || isNoAnswerDisconnection(disconnectionReason)) {
    return 'brak odpowiedzi';
  }

  if (bookedSlot) return 'umówiono';

  if (callSuccessful && preferredSessionDate) {
    return 'zainteresowany';
  }

  if (callSuccessful && hasTranscript) {
    return 'zainteresowany';
  }

  if (o) return 'zainteresowany';

  return 'brak odpowiedzi';
}

function resolveDirection(callDirection?: string): CallDirection {
  return callDirection === 'outbound' ? 'outbound' : 'inbound';
}

function resolveSource(
  direction: CallDirection,
  metadata?: Record<string, unknown>,
  vars?: Record<string, string>,
): LeadSource {
  const metaSource = String(metadata?.source ?? '').toLowerCase();
  if (metaSource === 'meta_lead_ad') return 'meta_lead_ad';
  if (metaSource === 'callback') return 'callback';
  if (vars?.campaign_name?.trim()) return 'meta_lead_ad';
  if (direction === 'inbound') return 'inbound_call';
  return 'unknown';
}

function resolvePhone(
  direction: CallDirection,
  call: Record<string, unknown>,
  vars: Record<string, string>,
): string {
  const fromCall =
    direction === 'outbound'
      ? call.to_number?.toString()
      : (call.from_number ?? call.to_number)?.toString();
  const raw = fromCall || vars.phone_number || '';
  return raw ? normalizeSheetPhone(raw) : '';
}

function resolveFullName(
  vars: Record<string, string>,
  custom: Record<string, unknown>,
  summaryName?: string,
): string {
  const fromCustom =
    custom.customer_name != null
      ? String(custom.customer_name)
      : custom.full_name != null
        ? String(custom.full_name)
        : '';
  return (
    vars.full_name?.trim() ||
    fromCustom.trim() ||
    summaryName?.trim() ||
    'Nieznany kontakt'
  );
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
    const metadata = (call.metadata ?? {}) as Record<string, unknown>;
    const summary = analysis.call_summary ?? '';
    const inferred = inferFromSummary(summary);

    const direction = resolveDirection(call.direction);
    const source = resolveSource(direction, metadata, vars);

    const phone = resolvePhone(direction, call as Record<string, unknown>, vars);
    const fullName = resolveFullName(vars, custom, inferred.name);

    let preferredSessionDate = normalizePreferredSessionDate(
      custom.preferred_session_date != null ? String(custom.preferred_session_date) : '',
    );

    const bookedSlot =
      custom.booked_slot != null
        ? String(custom.booked_slot)
        : custom.booked_appointment != null
          ? String(custom.booked_appointment)
          : '';

    const outcomeRaw = String(custom.outcome ?? '').toLowerCase().trim();
    let finalBookedSlot = bookedSlot;
    if (outcomeRaw === 'odwołanie' || outcomeRaw === 'odwolanie') {
      finalBookedSlot = '';
    }

    if (!preferredSessionDate && !finalBookedSlot && inferred.term) {
      preferredSessionDate = inferred.term;
    }

    const status = outcomeToStatus(
      String(custom.outcome ?? ''),
      analysis.call_successful,
      preferredSessionDate,
      finalBookedSlot,
      call.disconnection_reason,
      analysis.in_voicemail,
      Boolean((call.transcript ?? '').trim()),
      inferred.status,
    );

    const termColumn =
      status === 'odwołanie'
        ? ''
        : normalizePreferredSessionDate(finalBookedSlot || preferredSessionDate);

    const transcript = call.transcript ?? '';
    const upsertKey = phone || (call.call_id ? `call:${call.call_id}` : '');

    const sheet: VoiceLeadSheetRow = {
      phone,
      full_name: fullName,
      status,
      direction,
      source,
      call_summary: summary,
      recording_url: call.recording_url ?? '',
      transcript,
      sessions_per_week:
        custom.sessions_per_week != null ? String(custom.sessions_per_week) : '',
      preferred_session_date: termColumn,
      booked_slot: finalBookedSlot,
      goal: custom.goal != null ? String(custom.goal) : '',
      experience_level:
        custom.experience_level != null ? String(custom.experience_level) : '',
      updated_at: new Date().toISOString(),
    };

    return {
      json: {
        skipped: false,
        sheet,
        upsertKey,
        retellCallId: call.call_id ?? null,
        disconnectionReason: call.disconnection_reason ?? null,
      },
    };
  });
}
