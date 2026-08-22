/**
 * Build / merge Google Sheets rows when appointments are booked, cancelled,
 * or rescheduled during a live call (before call_analyzed).
 */

import type { VoiceLeadSheetRow, VoiceLeadStatus } from './types';
import {
  normalizeSheetPhone,
  sheetRowToValues,
  valuesToPartialSheetRow,
} from './sheetColumns';

export interface AppointmentSheetSyncInput {
  phone: string;
  fullName: string;
  status: Extract<VoiceLeadStatus, 'umówiono' | 'odwołanie' | 'przełożono'>;
  bookedSlot: string;
  direction?: string;
  callSummary?: string;
  goal?: string;
  experienceLevel?: string;
  sessionsPerWeek?: string;
}

export function buildAppointmentSheetRow(input: AppointmentSheetSyncInput): VoiceLeadSheetRow {
  const inbound = input.direction !== 'outbound';
  const term = input.status === 'odwołanie' ? '' : input.bookedSlot.trim();
  return {
    phone: normalizeSheetPhone(input.phone),
    full_name: input.fullName.trim() || 'Nieznany kontakt',
    status: input.status,
    direction: inbound ? 'inbound' : 'outbound',
    source: inbound ? 'inbound_call' : 'meta_lead_ad',
    call_summary: input.callSummary?.trim() ?? '',
    recording_url: '',
    transcript: '',
    sessions_per_week: input.sessionsPerWeek?.trim() ?? '',
    preferred_session_date: term,
    booked_slot: term,
    goal: input.goal?.trim() ?? '',
    experience_level: input.experienceLevel?.trim() ?? '',
    updated_at: new Date().toISOString(),
  };
}

/** Preserve transcript/recording from an existing row when syncing mid-call. */
export function mergeSheetRow(
  existing: Partial<VoiceLeadSheetRow> | Record<string, string>,
  incoming: VoiceLeadSheetRow,
): VoiceLeadSheetRow {
  const merged = { ...incoming };
  const keepIfEmpty = ['transcript', 'recording_url', 'call_summary'] as const;
  for (const key of keepIfEmpty) {
    if (!incoming[key]?.trim() && existing[key]?.trim()) {
      merged[key] = String(existing[key]).trim();
    }
  }
  if (existing.full_name?.trim() && incoming.full_name === 'Nieznany kontakt') {
    merged.full_name = String(existing.full_name).trim();
  }
  merged.status = incoming.status;
  merged.preferred_session_date = incoming.preferred_session_date;
  merged.booked_slot = incoming.booked_slot;
  merged.updated_at = incoming.updated_at;
  return merged;
}

export { sheetRowToValues, valuesToPartialSheetRow as valuesToSheetRow };
