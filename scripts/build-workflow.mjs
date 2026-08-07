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
function toE164(raw, defaultCountryCode = '+1') {
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
  const required = ['full_name', 'phone_number', 'campaign_name'];
  const missing = required.filter((k) => !p[k] || p[k].toString().trim() === '');
  if (missing.length) throw new Error('Missing required Meta fields: ' + missing.join(', '));
}

const output = items.map((item) => {
  const body = item.json.body ?? item.json;
  assertRequired(body);
  const name = splitName(body.full_name);
  const lead = {
    fullName: body.full_name.trim(),
    firstName: name.firstName,
    lastName: name.lastName,
    phoneE164: toE164(body.phone_number),
    campaignName: body.campaign_name.trim(),
    leadgenId: body.leadgen_id ?? null,
    sourcedAt: new Date().toISOString(),
  };
  return { json: { ...lead, _meta: body } };
});

return output;`;

// --- Code node #2 body (JS-compatible port of code/mapVapiToFrappe.ts) ------
const mapVapiToFrappeCode = `// Auto-ported from code/mapVapiToFrappe.ts — keep in sync.
function outcomeToStatus(outcome) {
  switch ((outcome ?? '').toLowerCase()) {
    case 'interested': return 'Interested';
    case 'callback': return 'Replied';
    case 'not_interested': return 'Do Not Contact';
    case 'no_answer':
    case 'voicemail': return 'Open';
    default: return 'Lead';
  }
}

function splitName(fullName) {
  const parts = (fullName ?? '').trim().split(/\\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || 'Unknown', last: parts[1] || '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

const output = items.map((item) => {
  const root = item.json.body ?? item.json;
  const msg = root.message ?? {};

  if (msg.type && msg.type !== 'end-of-call-report') {
    return { json: { skipped: true, reason: 'Ignored event: ' + msg.type } };
  }

  const vars = (msg.call && msg.call.assistantOverrides && msg.call.assistantOverrides.variableValues) || {};
  const structured = (msg.analysis && msg.analysis.structuredData) || {};

  const phone =
    (msg.call && msg.call.customer && msg.call.customer.number) ||
    (msg.customer && msg.customer.number) ||
    vars.phone_number ||
    '';

  const fullName = vars.full_name || structured.notes || 'Unknown Lead';
  const nm = splitName(fullName);

  const summary = (msg.analysis && msg.analysis.summary) || msg.summary || (structured && structured.notes) || '';
  const transcript = (msg.artifact && msg.artifact.transcript) || msg.transcript || '';
  // recordingUrl is an internal R2 path without auth — NOT playable in browser.
  // presignedMonoUrl includes the signature query string and actually works.
  const recordingUrl =
    (msg.artifact && (msg.artifact.presignedMonoUrl || msg.artifact.presignedStereoUrl)) ||
    (msg.artifact && msg.artifact.recordingUrl) ||
    '';

  const payload = {
    lead_name: fullName,
    first_name: nm.first,
    last_name: nm.last,
    mobile_no: phone,
    phone: phone,
    source: 'Campaign',
    custom_campaign: vars.campaign_name || 'Unknown',
    status: outcomeToStatus(structured.outcome),
    custom_call_outcome: structured.outcome || msg.endedReason || 'unknown',
    custom_call_summary: summary,
    custom_call_recording_url: recordingUrl,
    custom_vapi_call_id: (msg.call && msg.call.id) || '',
  };
  if (transcript) payload.notes = [{ note: 'Vapi transcript:\\n' + transcript }];

  return {
    json: {
      frappe: payload,
      upsertKey: phone,
      recordingDownloadUrl: recordingUrl,
      vapiCallId: (msg.call && msg.call.id) || '',
      structured: structured,
      endedReason: msg.endedReason ?? null,
      durationSeconds: msg.durationSeconds ?? null,
    },
  };
});

return output;`;

const buildVapiPayloadCode = `// Reads env via n8n's $env. The JS Task Runner sandbox does NOT expose
// 'process', so process.env is unavailable — $env is the supported accessor
// (requires N8N_BLOCK_ENV_ACCESS_IN_NODE=false + N8N_ENVIRONMENT_VARIABLES_ALLOW_LIST).
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const lead = items[0].json;
// Vapi (cloud) must reach n8n via a PUBLIC url. PUBLIC_WEBHOOK_URL points at the
// tunnel (e.g. cloudflared); falls back to WEBHOOK_URL for pure-local testing.
const webhookUrl = ((env.PUBLIC_WEBHOOK_URL || env.WEBHOOK_URL || 'http://localhost:5678/') + '').replace(/\\/?$/, '/');
// Vapi Bearer auth expects the raw UUID, not the 'vapi_sk_' prefixed form.
const vapiKey = ((env.VAPI_API_KEY || '') + '').trim().replace(/^vapi_sk_/, '');

const polishSystemPrompt = [
  'Jesteś Morgan, asystentką głosową ds. kontaktu z leadami.',
  'Dzwonisz do {{first_name}}, ponieważ ta osoba wypełniła formularz w kampanii Meta „{{campaign_name}}”.',
  '',
  'JĘZYK: Mów WYŁĄCZNIE po polsku. Brzmij jak prawdziwa osoba w rozmowie telefonicznej — ciepło, naturalnie, bez sztywnego „botowego” tonu.',
  'ODPOWIEDZI: Maksymalnie 1–2 krótkie zdania na raz. Nie monologuj. Zadaj TYLKO JEDNO pytanie i ZATRZYMAJ SIĘ — czekaj na odpowiedź, nie zadawaj kolejnego pytania w tej samej wypowiedzi.',
  'ZASADA KRYTYCZNA: NIGDY nie mów dwóch tur pod rząd bez odpowiedzi rozmówcy. Jeśli zadałaś pytanie — CZEKAJ w ciszy, aż rozmówca skończy mówić.',
  'POTWIERDZANIE: Gdy rozmówca poda liczbę, kwotę, dzień, termin lub zadaje pytanie (np. „200 złotych”, „poniedziałek”, „jakie są terminy?”), NAJPIERW krótko to potwierdź lub odpowiedz („Dwieście złotych, rozumiem.”, „Poniedziałek, super.”, „Sprawdzę dostępność.”), DOPIERO POTEM zadaj kolejne pytanie — jeśli w ogóle.',
  'NASŁUCH: Poczekaj aż rozmówca SKOŃCZY zdanie — zwłaszcza przy dłuższych wypowiedziach typu „mogę w poniedziałek jak przyszły”. Nie przerywaj i nie zadawaj nowego pytania, dopóki rozmówca mówi.',
  '',
  'CEL ROZMOWY:',
  '1. Upewnij się, że rozmawiasz z właściwą osobą.',
  '2. Potwierdź zainteresowanie ofertą z reklamy.',
  '3. Zadaj maksymalnie 2–3 pytania kwalifikujące (potrzeby, termin, budżet — jeśli pasuje do rozmowy).',
  '4. Umów kontakt z handlowcem albo grzecznie zakończ, jeśli brak zainteresowania.',
  '',
  'STYL:',
  '- Bądź ciepła, profesjonalna i konkretna.',
  '- Nie czytaj na głos danych wrażliwych.',
  '- Jeśli rozmówca nie ma czasu — zaproponuj oddzwonienie w dogodnym terminie.',
  '- Jeśli trafiasz na pocztę głosową — zostaw krótką wiadomość po polsku i zakończ.',
  '',
  'Na końcu ustal wynik rozmowy jako jeden z: interested | not_interested | callback | voicemail | no_answer.',
  '',
  'ZAKOŃCZENIE ROZMOWY: Gdy masz wystarczające informacje, rozmówca się żegna albo nie ma zainteresowania — krótko podsumuj w 1 zdaniu, powiedz „Dziękuję, do usłyszenia” i NATYCHMIAST użyj narzędzia endCall, żeby rozłączyć. Nie zostawiaj linii otwartej w ciszy po pożegnaniu.',
].join('\\n');

const maxDuration = Math.min(43200, Math.max(10, parseInt(((env.MAX_CALL_DURATION_SECONDS || '300') + ''), 10) || 300));
const wrapUpAt = Math.max(10, maxDuration - 30);
const hardEndAt = Math.max(10, maxDuration - 5);

return [{
  json: {
    vapiAuthHeader: 'Bearer ' + vapiKey,
    vapiBody: {
      assistantId: ((env.VAPI_ASSISTANT_ID || '') + '').trim(),
      phoneNumberId: ((env.VAPI_PHONE_NUMBER_ID || '') + '').trim(),
      customer: { number: lead.phoneE164, name: lead.fullName },
      assistantOverrides: {
        variableValues: {
          full_name: lead.fullName,
          first_name: lead.firstName,
          phone_number: lead.phoneE164,
          campaign_name: lead.campaignName,
          leadgen_id: lead.leadgenId,
        },
        // Assistant greets immediately on pickup (user preference). Interruptions
        // on the greeting stay enabled so the callee can talk over it naturally.
        firstMessageMode: 'assistant-speaks-first',
        firstMessageInterruptionsEnabled: true,
        firstMessage:
          'Cześć {{first_name}}, tu Morgan. Dzwonię w sprawie formularza z kampanii {{campaign_name}}. Czy masz teraz chwilę?',
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.75,
          maxTokens: 120,
          messages: [{ role: 'system', content: polishSystemPrompt }],
          tools: [{ type: 'endCall' }],
        },
        // Hard limit — call ends at maxDuration (default 5 min). Hooks warn and
        // gracefully hang up a few seconds before the cutoff.
        maxDurationSeconds: maxDuration,
        endCallMessage: 'Dziękuję za rozmowę. Do usłyszenia!',
        endCallPhrases: ['do usłyszenia', 'miłego dnia', 'dziękuję za rozmowę'],
        hooks: [
          {
            on: 'call.timeElapsed',
            options: { seconds: wrapUpAt },
            do: [{ type: 'say', exact: 'Jeszcze chwila i będę musiała kończyć rozmowę.' }],
          },
          {
            on: 'call.timeElapsed',
            options: { seconds: hardEndAt },
            do: [
              { type: 'say', exact: 'Dziękuję za rozmowę. Muszę kończyć — do usłyszenia!' },
              { type: 'tool', tool: { type: 'endCall' } },
            ],
          },
        ],
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'pl',
          endpointing: 350,
          smartFormat: false,
        },
        voice: {
          // Cartesia Sonic-3 — tańszy (~$0.015/min vs ElevenLabs ~$0.05/min),
          // szybki, wspiera polski natywnie. Konfigurowalne przez .env.
          provider: (env.VAPI_VOICE_PROVIDER || 'cartesia'),
          model: (env.VAPI_VOICE_MODEL || 'sonic-3'),
          voiceId: (env.VAPI_VOICE_ID || '3d335974-4c4a-400a-84dc-ebf4b73aada6'),
          language: 'pl',
          generationConfig: { speed: 0.96 },
        },
        // waitSeconds 0.9 — chwilowa pauza po odebraniu, żeby pierwsze słowo
        // („Cześć…”) nie było ucięte zanim kanał audio się ustabilizuje.
        startSpeakingPlan: {
          waitSeconds: 0.9,
          smartEndpointingPlan: { provider: 'vapi' },
          transcriptionEndpointingPlan: {
            onPunctuationSeconds: 0.15,
            onNoPunctuationSeconds: 1.4,
            onNumberSeconds: 0.5,
          },
        },
        // Pozwala rozmówcy wejść w słowo (naturalna rozmowa), bez łykania
        // krótkich wtrąceń jako backchannel.
        stopSpeakingPlan: {
          numWords: 0,
          voiceSeconds: 0.2,
          backoffSeconds: 1.0,
        },
        analysisPlan: {
          // Poprawny klucz to summaryPlan (nie summaryPrompt) — inaczej Vapi
          // nie generuje analysis.summary i pole w CRM zostaje puste.
          summaryPlan: {
            enabled: true,
            messages: [
              {
                role: 'system',
                content:
                  'Jesteś asystentem tworzącym krótkie notatki CRM po polsku. Podsumuj rozmowę w 2–3 zdaniach: zainteresowanie, potrzeby, ustalony termin/oddzwonienie oraz budżet, jeśli padł.',
              },
              { role: 'user', content: 'Transkrypcja rozmowy:\\n\\n{{transcript}}' },
            ],
          },
          structuredDataPlan: {
            enabled: true,
            schema: {
              type: 'object',
              properties: {
                outcome: {
                  type: 'string',
                  enum: ['interested', 'not_interested', 'callback', 'no_answer', 'voicemail'],
                  description: 'Finalna klasyfikacja rozmowy.',
                },
                callback_at: { type: 'string', description: 'ISO datetime jeśli umówiono oddzwonienie.' },
                budget: { type: 'string', description: 'Budżet podany przez leada, jeśli padł.' },
                notes: { type: 'string', description: 'Krótka notatka dla handlowca.' },
              },
              required: ['outcome'],
            },
          },
        },
        // End-of-call webhook (Flow B). Vapi's /call schema nests server config
        // under assistantOverrides, not at the top level.
        serverMessages: ['end-of-call-report'],
        server: {
          url: webhookUrl + 'webhook/vapi-end-of-call',
          timeoutSeconds: 30,
        },
        metadata: {
          source: 'meta_lead_ad',
          n8n_execution_id: (typeof $execution !== 'undefined' && $execution) ? $execution.id : null,
        },
      },
    },
  },
}];`;

const buildFrappeRequestCode = `// Attach Frappe HTTP headers/URL to mapped payload.
// Uses $env (JS Task Runner sandbox has no 'process').
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const item = items[0].json;
const base = ((env.FRAPPE_BASE_URL || 'http://frontend:8080') + '').replace(/\\/?$/, '');
return [{
  json: {
    ...item,
    frappeUrl: base + '/api/resource/Lead',
    frappeAuthHeader: 'token ' + ((env.FRAPPE_API_KEY || '') + '') + ':' + ((env.FRAPPE_API_SECRET || '') + ''),
  },
}];`;

const attachRecordingCode = `// Download Vapi recording and upload to Frappe — permanent /files/ URL
// (presignedMonoUrl from Vapi expires after ~30 min).
const env = (typeof $env !== 'undefined' && $env) ? $env : {};
const helpers = (typeof $helpers !== 'undefined' && $helpers) ? $helpers : this.helpers;
const mapItem = $('Map Vapi to Frappe').first().json;
const upsert = $('Upsert Frappe Lead').first().json;
const leadName = (upsert.data && upsert.data.name) || upsert.name || null;
const downloadUrl = mapItem.recordingDownloadUrl || '';
const callId = mapItem.vapiCallId || 'vapi-call';
const publicBase = ((env.FRAPPE_PUBLIC_URL || 'http://localhost:8083') + '').replace(/\\/?$/, '');
const apiBase = ((env.FRAPPE_BASE_URL || 'http://frontend:8080') + '').replace(/\\/?$/, '');
const auth = 'token ' + ((env.FRAPPE_API_KEY || '') + '') + ':' + ((env.FRAPPE_API_SECRET || '') + '');

if (!downloadUrl || !leadName) {
  return [{ json: { attached: false, reason: 'missing recording url or lead name', leadName } }];
}

try {
  const audioBuf = await helpers.httpRequest({
    method: 'GET',
    url: downloadUrl,
    encoding: 'arraybuffer',
  });
  const filename = callId + '.wav';
  const boundary = '----FormBoundary' + Date.now();
  let header = '';
  for (const [k, v] of Object.entries({ doctype: 'Lead', docname: leadName, is_private: '0' })) {
    header += '--' + boundary + '\\r\\nContent-Disposition: form-data; name=\"' + k + '\"\\r\\n\\r\\n' + v + '\\r\\n';
  }
  header += '--' + boundary + '\\r\\nContent-Disposition: form-data; name=\"file\"; filename=\"' + filename + '\"\\r\\nContent-Type: audio/wav\\r\\n\\r\\n';
  const bodyStart = Buffer.from(header, 'utf8');
  const bodyEnd = Buffer.from('\\r\\n--' + boundary + '--\\r\\n', 'utf8');
  const uploadBody = Buffer.concat([bodyStart, Buffer.from(audioBuf), bodyEnd]);

  const uploadJson = await helpers.httpRequest({
    method: 'POST',
    url: apiBase + '/api/method/upload_file',
    headers: {
      Authorization: auth,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body: uploadBody,
    json: true,
  });

  const fileUrl = (uploadJson.message && uploadJson.message.file_url) || uploadJson.file_url || '';
  const permanentUrl = fileUrl.startsWith('http') ? fileUrl : publicBase + fileUrl;

  await helpers.httpRequest({
    method: 'PUT',
    url: apiBase + '/api/resource/Lead/' + encodeURIComponent(leadName),
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: { custom_call_recording_url: permanentUrl },
    json: true,
  });

  return [{ json: { attached: true, leadName, permanentUrl } }];
} catch (err) {
  return [{ json: { attached: false, leadName, error: String((err && err.message) || err) } }];
}`;

// HTTP nodes use $json only — no $env in expressions (n8n UI blocks preview).
const wf = {
  name: 'Vapi Outbound Voice Agent — Meta → Vapi → Frappe',
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
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildVapiPayloadCode },
      id: 'code-build-vapi',
      name: 'Build Vapi Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [170, -80],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.vapi.ai/call',
        authentication: 'none',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ $json.vapiAuthHeader }}' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.vapiBody }}',
        // neverError keeps item pairing intact on 4xx so Ack Meta can still
        // reference Parse Meta Lead; fullResponse exposes statusCode + error body.
        options: { response: { response: { neverError: true, fullResponse: true, responseFormat: 'json' } } },
      },
      id: 'http-vapi',
      name: 'Dispatch Vapi Call',
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
          '={{ { "status": "accepted", "httpStatus": ($json.statusCode || null), "vapiCallId": (($json.body && $json.body.id) || null), "vapiError": (($json.body && ($json.body.message || $json.body.error)) || null), "lead": $(\'Parse Meta Lead\').first().json.fullName } }}',
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
        path: 'vapi-end-of-call',
        responseMode: 'responseNode',
        options: {},
      },
      id: 'webhook-vapi',
      name: 'Webhook — Vapi End Of Call',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-160, 220],
      webhookId: 'vapi-end-of-call',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mapVapiToFrappeCode },
      id: 'code-map-frappe',
      name: 'Map Vapi to Frappe',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [170, 220],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildFrappeRequestCode },
      id: 'code-build-frappe-req',
      name: 'Build Frappe Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [280, 220],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ $json.frappeUrl }}',
        authentication: 'none',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: 'Authorization',
              value: '={{ $json.frappeAuthHeader }}',
            },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Accept', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.frappe }}',
        options: { response: { response: { neverError: false, responseFormat: 'json' } } },
      },
      id: 'http-frappe',
      name: 'Upsert Frappe Lead',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [500, 220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: attachRecordingCode },
      id: 'code-attach-recording',
      name: 'Attach Recording to Frappe',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [610, 220],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody:
          '={{ { "status": "processed", "lead": (($("Upsert Frappe Lead").first().json.data && $("Upsert Frappe Lead").first().json.data.name) || null), "recordingUpload": "background" } }}',
        options: { responseCode: 200 },
      },
      id: 'respond-vapi',
      name: 'Ack Vapi',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [720, 220],
    },
  ],
  connections: {
    'Webhook — Meta Lead': { main: [[{ node: 'Parse Meta Lead', type: 'main', index: 0 }]] },
    'Parse Meta Lead': { main: [[{ node: 'Build Vapi Payload', type: 'main', index: 0 }]] },
    'Build Vapi Payload': { main: [[{ node: 'Dispatch Vapi Call', type: 'main', index: 0 }]] },
    'Dispatch Vapi Call': { main: [[{ node: 'Ack Meta', type: 'main', index: 0 }]] },
    'Webhook — Vapi End Of Call': { main: [[{ node: 'Map Vapi to Frappe', type: 'main', index: 0 }]] },
    'Map Vapi to Frappe': { main: [[{ node: 'Build Frappe Request', type: 'main', index: 0 }]] },
    'Build Frappe Request': { main: [[{ node: 'Upsert Frappe Lead', type: 'main', index: 0 }]] },
    'Upsert Frappe Lead': {
      main: [[
        { node: 'Ack Vapi', type: 'main', index: 0 },
        { node: 'Attach Recording to Frappe', type: 'main', index: 0 },
      ]],
    },
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [{ name: 'vapi' }, { name: 'frappe' }, { name: 'voice-agent' }],
};

mkdirSync(join(root, 'workflows'), { recursive: true });
const out = join(root, 'workflows', 'vapi-outbound-agent.json');
writeFileSync(out, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('Wrote', out);
