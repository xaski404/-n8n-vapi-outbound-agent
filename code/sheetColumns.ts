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
      (row as Record<string, string>)[key] = values[index];
    }
  });
  return row;
}

/** Last matching row (1-based sheet row number) for upsert after book/reschedule during a call. */
export function findLastSheetRowByPhone(
  rows: string[][],
  phone: string,
): { rowNumber: number; values: string[] | null } {
  const key = normalizeSheetPhone(phone);
  let rowNumber = 0;
  let values: string[] | null = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && normalizeSheetPhone(rows[i][0]) === key) {
      rowNumber = i + 1;
      values = rows[i];
    }
  }
  return { rowNumber, values };
}

const BOOKING_STATUSES = new Set<VoiceLeadSheetRow['status']>(['umówiono', 'przełożono']);

/** Merge post-call analysis into an existing CRM row (e.g. created during book/reschedule). */
export function mergeSheetRowsForUpsert(
  existing: Partial<VoiceLeadSheetRow>,
  incoming: VoiceLeadSheetRow,
): VoiceLeadSheetRow {
  const merged: VoiceLeadSheetRow = { ...incoming };

  if (incoming.transcript?.trim()) merged.transcript = incoming.transcript.trim();
  else if (existing.transcript?.trim()) merged.transcript = existing.transcript;

  if (incoming.recording_url?.trim()) merged.recording_url = incoming.recording_url.trim();
  else if (existing.recording_url?.trim()) merged.recording_url = existing.recording_url;

  if (incoming.call_summary?.trim()) merged.call_summary = incoming.call_summary.trim();
  else if (existing.call_summary?.trim()) merged.call_summary = existing.call_summary;

  const incomingTerm =
    incoming.preferred_session_date?.trim() || incoming.booked_slot?.trim() || '';
  const existingTerm =
    existing.preferred_session_date?.trim() || existing.booked_slot?.trim() || '';
  if (!incomingTerm && existingTerm) {
    merged.preferred_session_date = existingTerm;
    merged.booked_slot = existing.booked_slot ?? existingTerm;
  }

  if (
    incoming.full_name === 'Nieznany kontakt' &&
    existing.full_name?.trim() &&
    existing.full_name !== 'Nieznany kontakt'
  ) {
    merged.full_name = existing.full_name;
  }

  if (
    existing.status &&
    BOOKING_STATUSES.has(existing.status) &&
    incoming.status === 'zainteresowany'
  ) {
    merged.status = existing.status;
  }

  if (!incoming.sessions_per_week?.trim() && existing.sessions_per_week?.trim()) {
    merged.sessions_per_week = existing.sessions_per_week;
  }

  return merged;
}
