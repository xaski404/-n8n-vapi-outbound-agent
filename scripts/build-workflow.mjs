/**
 * Deterministically builds the importable n8n workflow JSON.
 * Embedding multi-line JS (with regex backslashes) as JSON string literals by
 * hand is error-prone, so we assemble the object in JS and JSON.stringify it —
 * escaping is then guaranteed correct.
 *
 *   node scripts/build-workflow.mjs
 * emits: workflows/vapi-outbound-agent.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// --- Code node #1 body (JS-compatible port of code/parseMetaLead.ts) --------
const parseMetaLeadCode = `// Auto-ported from code/parseMetaLead.ts — keep in sync.
function toE164(raw, defaultCountryCode = '+48') {
  const trimmed = (raw ?? '').toString().trim();
  if (!trimmed) throw new Error('phone_number is empty');
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/[^\\d+]/g, '');
    if (!/^\\+\\d{7,15}$/.test(digits)) throw new Error('Invalid E.164 phone: ' + raw);
    return digits;
  }
  const digitsOnly = trimmed.replace(/\\D/g, '');
  if (digitsOnly.length < 7) throw new Error('Phone too short: ' + raw);
  if (digitsOnly.startsWith('00')) return '+' + digitsOnly.slice(2);
  return defaultCountryCode + digitsOnly;
}

function splitName(fullName) {
  const parts = (fullName ?? '').toString().trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Lead' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function assertRequired(p) {
  const required = ['full_name', 'phone_number'];
  const missing = required.filter((k) => !p[k] || p[k].toString().trim() === '');
  if (missing.length) throw new Error('Missing required Meta fields: ' + missing.join(', '));
}

const DEFAULT_CAMPAIGN = 'skibidi essaa six seven musztarda';

const output = items.map((item) => {
  const body = item.json.body ?? item.json;
  assertRequired(body);
  const name = splitName(body.full_name);
  const lead = {
    fullName: body.full_name.trim(),
    firstName: name.firstName,
    lastName: name.lastName,
    phoneE164: toE164(body.phone_number),
    campaignName: (body.campaign_name && body.campaign_name.toString().trim()) || DEFAULT_CAMPAIGN,
    leadgenId: body.leadgen_id ?? null,
    sourcedAt: new Date().toISOString(),
  };
  return { json: { ...lead, _meta: body } };
});

return output;`;

// --- Code node #2 body (JS-compatible port of code/mapRetellToSheets.ts) ----
const mapRetellToSheetsCode = `// Auto-ported from code/mapRetellToSheets.ts — keep in sync.
const HOUR_WORD_TO_DIGIT = [
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

function normalizePreferredSessionDate(value) {
  let result = (value || '').trim();
  if (!result) return result;
  result = result.replace(/wpół do szesnastej/gi, 'o 15:30');
  result = result.replace(/piętnasta trzydzieści/gi, 'o 15:30');
  for (const pair of HOUR_WORD_TO_DIGIT) {
    const word = pair[0];
    const digit = pair[1];
    const pattern = new RegExp('o\\\\s+' + word, 'gi');
    result = result.replace(pattern, 'o ' + digit);
  }
  return result.replace(/\\s+/g, ' ').trim();
}

function outcomeToStatus(outcome, callSuccessful, preferredSessionDate) {
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

const output = items.map((item) => {
  const root = item.json.body ?? item.json;
  const event = root.event ?? '';
  const env = (typeof $env !== 'undefined' && $env) ? $env : {};

  if (event !== 'call_analyzed') {
    return { json: { skipped: true, reason: 'Ignored event: ' + (event || 'unknown') } };
  }

  const call = root.call || {};
  const vars = call.retell_llm_dynamic_variables || {};
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};

  const phone =
    (call.direction === 'outbound' ? call.to_number : call.from_number) ||
    vars.phone_number ||
    '';

  const fullName = vars.full_name || custom.notes || 'Nieznany kontakt';

  const preferredSessionDate = normalizePreferredSessionDate(
    custom.preferred_session_date != null ? String(custom.preferred_session_date) : '',
  );

  const sheet = {
    phone: phone,
    full_name: fullName,
    status: outcomeToStatus(
      custom.outcome != null ? String(custom.outcome) : '',
      analysis.call_successful,
      preferredSessionDate,
    ),
    call_summary: analysis.call_summary || '',
    recording_url: call.recording_url || '',
    transcript: call.transcript || '',
    sessions_per_week: custom.sessions_per_week != null ? String(custom.sessions_per_week) : '',
    preferred_session_date: preferredSessionDate,
  };

  return {
    json: {
      skipped: false,
      sheet: sheet,
      upsertKey: phone,
      retellCallId: call.call_id || null,
      disconnectionReason: call.disconnection_reason || null,
      sheetsDocumentId: ((env.GOOGLE_SHEETS_DOCUMENT_ID || '') + ''),
      sheetsSheetName: ((env.GOOGLE_SHEETS_SHEET_NAME || 'Leads') + ''),
    },
  };
});

return output;`;

const sheetColumnKeys = [
  'phone',
  'full_name',
  'status',
  'call_summary',
  'recording_url',
  'transcript',
  'sessions_per_week',
  'preferred_session_date',
];

const sheetColumnsSchema = sheetColumnKeys.map((id) => ({
  id,
  displayName: id,
  required: false,
  defaultMatch: id === 'phone',
  display: true,
  type: 'string',
  canBeUsedToMatch: id === 'phone',
}));

const sheetColumnValues = Object.fromEntries(
  sheetColumnKeys.map((key) => [key, `={{ $json.sheet.${key} }}`]),
);

const buildRetellPayloadCode = `// Agent prompt/voice live in Retell dashboard — n8n only dispatches the call.
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const lead = items[0].json;
const retellKey = ((env.RETELL_API_KEY || '') + '').trim();
const fromNumber = ((env.RETELL_FROM_NUMBER || '+48324412887') + '').trim();
const agentId = ((env.RETELL_AGENT_ID || '') + '').trim();

return [{
  json: {
    retellAuthHeader: 'Bearer ' + retellKey,
    retellBody: {
      from_number: fromNumber,
      to_number: lead.phoneE164,
      override_agent_id: agentId,
      metadata: {
        source: 'meta_lead_ad',
        leadgen_id: lead.leadgenId,
      },
      retell_llm_dynamic_variables: {
        full_name: lead.fullName,
        phone_number: lead.phoneE164,
        campaign_name: lead.campaignName,
      },
    },
  },
}];`;

// HTTP nodes use $json only — no $env in expressions (n8n UI blocks preview).
const wf = {
  name: 'Retell Outbound Voice Agent — Meta → Retell → Google Sheets',
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  nodes: [
    // ---------------------------- FLOW A: dispatch --------------------------
    {
      parameters: {
        httpMethod: 'POST',
        path: 'meta-lead-inbound',
        responseMode: 'responseNode',
        options: {},
      },
      id: 'webhook-meta',
      name: 'Webhook — Meta Lead',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-160, -80],
      webhookId: 'meta-lead-inbound',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseMetaLeadCode },
      id: 'code-parse-meta',
      name: 'Parse Meta Lead',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [60, -80],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildRetellPayloadCode },
      id: 'code-build-retell',
      name: 'Build Retell Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [170, -80],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.retellai.com/v2/create-phone-call',
        authentication: 'none',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ $json.retellAuthHeader }}' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.retellBody }}',
        // neverError keeps item pairing intact on 4xx so Ack Meta can still
        // reference Parse Meta Lead; fullResponse exposes statusCode + error body.
        options: { response: { response: { neverError: true, fullResponse: true, responseFormat: 'json' } } },
      },
      id: 'http-retell',
      name: 'Dispatch Retell Call',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [390, -80],
      // Best-practice error handling: retry transient failures, then continue
      // so the webhook still ACKs Meta instead of 500-ing.
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody:
          '={{ { "status": "accepted", "httpStatus": ($json.statusCode || null), "retellCallId": (($json.body && $json.body.call_id) || null), "retellError": (($json.body && ($json.body.message || $json.body.error)) || null), "lead": $(\'Parse Meta Lead\').first().json.fullName } }}',
        options: { responseCode: 202 },
      },
      id: 'respond-meta',
      name: 'Ack Meta',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [610, -80],
    },

    // --------------------------- FLOW B: resolution -------------------------
    {
      parameters: {
        httpMethod: 'POST',
        path: 'retell-call-analyzed',
        responseMode: 'responseNode',
        options: {},
      },
      id: 'webhook-retell',
      name: 'Webhook — Retell Call Analyzed',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-160, 220],
      webhookId: 'retell-call-analyzed',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mapRetellToSheetsCode },
      id: 'code-map-sheets',
      name: 'Map Retell to Sheets',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [60, 220],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: 'call-analyzed',
              leftValue: '={{ $json.skipped }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'notEquals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-end-of-call',
      name: 'Call analyzed?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [280, 220],
    },
    {
      parameters: {
        method: 'GET',
        url: '=https://sheets.googleapis.com/v4/spreadsheets/{{ $json.sheetsDocumentId }}?fields=sheets.properties.title',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleSheetsOAuth2Api',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-get-tab',
      name: 'Get Sheet Tab Name',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [420, 160],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ "https://sheets.googleapis.com/v4/spreadsheets/" + $("Map Retell to Sheets").first().json.sheetsDocumentId + "/values/" + encodeURIComponent("\'" + ($json.sheets[0].properties.title) + "\'!A:H") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS" }}',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleSheetsOAuth2Api',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { "values": [[ $("Map Retell to Sheets").first().json.sheet.phone, $("Map Retell to Sheets").first().json.sheet.full_name, $("Map Retell to Sheets").first().json.sheet.status, $("Map Retell to Sheets").first().json.sheet.call_summary, $("Map Retell to Sheets").first().json.sheet.recording_url, $("Map Retell to Sheets").first().json.sheet.transcript, $("Map Retell to Sheets").first().json.sheet.sessions_per_week, $("Map Retell to Sheets").first().json.sheet.preferred_session_date ]] } }}',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      id: 'sheets-append-http',
      name: 'Append Google Sheets Row',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [620, 160],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody:
          '={{ { "status": ($("Map Retell to Sheets").first().json.skipped ? "skipped" : "processed"), "phone": (($("Map Retell to Sheets").first().json.sheet && $("Map Retell to Sheets").first().json.sheet.phone) || null), "reason": ($("Map Retell to Sheets").first().json.reason || null) } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-retell',
      name: 'Ack Retell',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [720, 220],
    },
  ],
  connections: {
    'Webhook — Meta Lead': { main: [[{ node: 'Parse Meta Lead', type: 'main', index: 0 }]] },
    'Parse Meta Lead': { main: [[{ node: 'Build Retell Payload', type: 'main', index: 0 }]] },
    'Build Retell Payload': { main: [[{ node: 'Dispatch Retell Call', type: 'main', index: 0 }]] },
    'Dispatch Retell Call': { main: [[{ node: 'Ack Meta', type: 'main', index: 0 }]] },
    'Webhook — Retell Call Analyzed': { main: [[{ node: 'Map Retell to Sheets', type: 'main', index: 0 }]] },
    'Map Retell to Sheets': { main: [[{ node: 'Call analyzed?', type: 'main', index: 0 }]] },
    'Call analyzed?': {
      main: [
        [{ node: 'Get Sheet Tab Name', type: 'main', index: 0 }],
        [{ node: 'Ack Retell', type: 'main', index: 0 }],
      ],
    },
    'Get Sheet Tab Name': { main: [[{ node: 'Append Google Sheets Row', type: 'main', index: 0 }]] },
    'Append Google Sheets Row': { main: [[{ node: 'Ack Retell', type: 'main', index: 0 }]] },
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [{ name: 'retell' }, { name: 'google-sheets' }, { name: 'voice-agent' }],
};

mkdirSync(join(root, 'workflows'), { recursive: true });
const out = join(root, 'workflows', 'vapi-outbound-agent.json');
writeFileSync(out, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('Wrote', out);
