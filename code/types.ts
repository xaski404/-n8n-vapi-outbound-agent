/**
 * Shared type contracts for the Vapi <-> Frappe voice-agent pipeline.
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

/** Normalised lead used to build the Vapi call request. */
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

/* ------------------------------ Vapi report ------------------------------ */

export type VapiEndedReason = string;

export interface VapiStructuredData {
  /** Outcome the assistant recorded via function/tool calling. */
  outcome?: 'interested' | 'not_interested' | 'callback' | 'no_answer' | 'voicemail' | string;
  callback_at?: string;
  budget?: string | number;
  notes?: string;
  [key: string]: unknown;
}

export interface VapiMessage {
  role: 'assistant' | 'user' | 'system' | 'tool' | 'bot';
  message?: string;
  time?: number;
}

/** The relevant slice of Vapi's end-of-call-report webhook body. */
export interface VapiEndOfCallReport {
  message: {
    type: 'end-of-call-report' | string;
    endedReason?: VapiEndedReason;
    call?: {
      id?: string;
      customer?: { number?: string };
      assistantId?: string;
      /** Values we injected at dispatch time round-trip back here. */
      assistantOverrides?: { variableValues?: Record<string, unknown> };
    };
    /** Present when a phone number was called. */
    phoneNumber?: { number?: string };
    customer?: { number?: string };
    artifact?: {
      transcript?: string;
      messages?: VapiMessage[];
      recordingUrl?: string;
    };
    /** Some payload versions place transcript/summary at message root. */
    transcript?: string;
    summary?: string;
    analysis?: {
      summary?: string;
      structuredData?: VapiStructuredData;
      successEvaluation?: string | boolean;
    };
    durationSeconds?: number;
    startedAt?: string;
    endedAt?: string;
  };
}

/* ------------------------------ Frappe CRM ------------------------------- */

/**
 * Payload for Frappe `Lead` doctype (ERPNext) REST upsert.
 * Field names map to the standard ERPNext Lead docfields.
 */
export interface FrappeLeadUpsert {
  lead_name: string;
  first_name: string;
  last_name: string;
  mobile_no: string;
  phone: string;
  source: string;
  campaign_name: string;
  status: 'Lead' | 'Open' | 'Replied' | 'Interested' | 'Converted' | 'Do Not Contact' | 'Quotation';
  custom_call_outcome?: string;
  custom_call_summary?: string;
  custom_call_recording_url?: string;
  custom_vapi_call_id?: string;
  notes?: Array<{ note: string }>;
}
