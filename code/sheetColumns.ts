/**
 * Google Sheets column layout — must match the user's "Leads" tab (A–H).
 *
 * A numer telefonu | B imię i nazwisko | C status | D podsumowanie
 * E nagranie | F transkrypcja | G ilość sesji | H preferowany termin
 */

import type { VoiceLeadSheetRow } from './types';

export const VOICE_LEAD_SHEET_COLUMNS = [
  'phone',
  'full_name',
  'status',
  'call_summary',
  'recording_url',
  'transcript',
  'sessions_per_week',
  'preferred_session_date',
] as const satisfies readonly (keyof VoiceLeadSheetRow)[];

export type VoiceLeadSheetColumn = (typeof VOICE_LEAD_SHEET_COLUMNS)[number];

/** Store/compare phones as digits only (48799839938) — matches existing sheet rows. */
export function normalizeSheetPhone(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

export function sheetRowToValues(row: VoiceLeadSheetRow): string[] {
  const term = row.preferred_session_date?.trim() || row.booked_slot?.trim() || '';
  return [
    normalizeSheetPhone(row.phone),
    row.full_name ?? '',
    row.status ?? '',
    row.call_summary ?? '',
    row.recording_url ?? '',
    row.transcript ?? '',
    row.sessions_per_week ?? '',
    term,
  ];
}

export function valuesToPartialSheetRow(values: string[]): Partial<VoiceLeadSheetRow> {
  const row: Partial<VoiceLeadSheetRow> = {};
  VOICE_LEAD_SHEET_COLUMNS.forEach((key, index) => {
    if (values[index] != null && values[index] !== '') {
      row[key] = values[index];
    }
  });
  return row;
}
