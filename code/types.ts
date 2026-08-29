/**
 * Shared type contracts for the Retell AI <-> Google Sheets voice-agent pipeline.
 *
 * NOTE ON RUNTIME: n8n's "Code" node executes JavaScript, not TypeScript.
 * These .ts files are the authored source of truth (typed, reviewable, unit-
 * testable). The n8n workflow embeds the transpiled/JS-compatible equivalent
 * inside each Code node. Keep the two in sync; run `npm run build` (see
 * README) to emit the JS if you prefer generating rather than hand-porting.
 */

/* ----------------------------- Meta Lead Ad ------------------------------ */

/** Minimal shape we require from the simulated Meta Lead Ad webhook. */
export interface MetaLeadPayload {
  full_name: string;
  phone_number: string;
  campaign_name: string;
  /** Optional passthrough fields Meta may send; kept for traceability. */
  leadgen_id?: string;
  form_id?: string;
  created_time?: string;
  [key: string]: unknown;
}

/** Normalised lead used to build the Retell outbound call request. */
export interface NormalisedLead {
  fullName: string;
  firstName: string;
  lastName: string;
  /** E.164 formatted, e.g. +14155552671 */
  phoneE164: string;
  campaignName: string;
  leadgenId: string | null;
  sourcedAt: string; // ISO-8601
}

/* ----------------------------- Retell webhook ---------------------------- */

export interface RetellCallAnalysis {
  call_summary?: string;
  in_voicemail?: boolean;
  user_sentiment?: string;
  call_successful?: boolean;
  custom_analysis_data?: Record<string, unknown>;
}

export interface RetellCallObject {
  call_type?: string;
  call_id?: string;
  agent_id?: string;
  direction?: 'inbound' | 'outbound' | string;
  from_number?: string;
  to_number?: string;
  disconnection_reason?: string;
  transcript?: string;
  recording_url?: string;
  retell_llm_dynamic_variables?: Record<string, string>;
  call_analysis?: RetellCallAnalysis;
  metadata?: Record<string, unknown>;
}

/** Retell `call_analyzed` webhook body. */
export interface RetellCallAnalyzedWebhook {
  event: 'call_analyzed' | string;
  call?: RetellCallObject;
}

/* ---------------------------- Google Sheets ---------------------------- */

export type VoiceLeadStatus =
  | 'zainteresowany'
  | 'niezainteresowany'
  | 'brak odpowiedzi'
  | 'umówiono'
  | 'odwołanie'
  | 'przełożono';
export type CallDirection = 'inbound' | 'outbound';
export type LeadSource = 'inbound_call' | 'meta_lead_ad' | 'callback' | 'unknown';

/** One row in the voice-leads spreadsheet (A–H on the Leads tab). */
export interface VoiceLeadSheetRow {
  phone: string;
  full_name: string;
  status: VoiceLeadStatus;
  call_summary: string;
  recording_url: string;
  transcript: string;
  sessions_per_week: string;
  preferred_session_date: string;
  /** Used internally when mapping live booking sync; written to column H. */
  booked_slot?: string;
  /** Not written to sheet — kept for merge logic only. */
  direction?: CallDirection | string;
  source?: LeadSource | string;
  goal?: string;
  experience_level?: string;
  updated_at?: string;
}

export { VOICE_LEAD_SHEET_COLUMNS } from './sheetColumns';
