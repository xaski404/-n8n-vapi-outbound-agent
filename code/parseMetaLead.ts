/**
 * n8n Code node #1  —  "Parse Meta Lead"
 * Runs after the inbound Meta Lead Ad webhook. Validates the payload,
 * normalises the phone number to E.164, and splits the full name so the
 * downstream Vapi HTTP node can inject clean variables.
 *
 * n8n contract: returns an array of items ({ json: {...} }). We keep the raw
 * payload under `_meta` for auditing and expose the normalised lead at root.
 */

import type { MetaLeadPayload, NormalisedLead } from './types';

/** Coerce arbitrary phone input to E.164. Assumes a default country code. */
function toE164(raw: string, defaultCountryCode = '+1'): string {
  const trimmed = (raw ?? '').toString().trim();
  if (!trimmed) throw new Error('phone_number is empty');

  // Already looks international.
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/[^\d+]/g, '');
    if (!/^\+\d{7,15}$/.test(digits)) throw new Error(`Invalid E.164 phone: ${raw}`);
    return digits;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 7) throw new Error(`Phone too short: ${raw}`);

  // Handle a leading intl. prefix like "00" -> "+".
  if (digitsOnly.startsWith('00')) return `+${digitsOnly.slice(2)}`;

  return `${defaultCountryCode}${digitsOnly}`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').toString().trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Lead' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function assertRequired(p: Partial<MetaLeadPayload>): asserts p is MetaLeadPayload {
  const missing = (['full_name', 'phone_number', 'campaign_name'] as const).filter(
    (k) => !p[k] || p[k].toString().trim() === '',
  );
  if (missing.length) throw new Error(`Missing required Meta fields: ${missing.join(', ')}`);
}

// --- n8n execution body ------------------------------------------------------
// `items` is provided by the n8n Code node runtime. The webhook body is under
// item.json.body (n8n wraps webhook payloads). We defensively support both.
// Exported as a function so it is unit-testable; inside the n8n Code node the
// body of this function is what you paste (with a top-level `return output;`).
interface N8nItem {
  json: Record<string, unknown> & { body?: Partial<MetaLeadPayload> };
}

export function parseMetaLead(items: N8nItem[]): Array<{ json: NormalisedLead & { _meta: MetaLeadPayload } }> {
  return items.map((item) => {
    const body = (item.json.body ?? item.json) as Partial<MetaLeadPayload>;
    assertRequired(body);

    const { firstName, lastName } = splitName(body.full_name);
    const lead: NormalisedLead = {
      fullName: body.full_name.trim(),
      firstName,
      lastName,
      phoneE164: toE164(body.phone_number),
      campaignName: body.campaign_name.trim(),
      leadgenId: body.leadgen_id ?? null,
      sourcedAt: new Date().toISOString(),
    };

    return { json: { ...lead, _meta: body } };
  });
}
