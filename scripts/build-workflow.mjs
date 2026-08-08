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
  'Jesteś Morgan, asystentką głosową Kuby — trenera personalnego.',
  'Kontekst: dzwonisz, bo rozmówca wcześniej wypełnił formularz zapisu na BEZPŁATNY trening personalny w reklamie na Facebooku (Meta), kampania „{{campaign_name}}”.',
  'Powód dzwonienia: potwierdzić zapis z formularza Meta i umówić pierwszą darmową sesję u Kuby.',
  '',
  'RODO (OBOWIĄZKOWE — PIERWSZE ZDANIE ROZMOWY):',
  'Zanim przejdziesz do czegokolwiek innego, ZAWSZE zacznij dokładnie od: „Informuję, że rozmowa jest nagrywana w celu umówienia treningu.”',
  'To musi paść jako pierwsze zdanie — przed powitaniem, przed pytaniami, przed kampanią. Nie pomijaj tego nigdy.',
  '',
  'OFERTA:',
  'Pierwsza sesja treningu personalnego jest w 100% za darmo. Potem można kontynuować na płatnych pakietach — o tym też możesz krótko wspomnieć przy pytaniu o budżet.',
  '',
  'JĘZYK: Mów WYŁĄCZNIE po polsku. Brzmij naturalnie, jak w normalnej rozmowie telefonicznej.',
  'TON (WAŻNE): Mów zawsze miło, ciepło i uprzejmie, ale neutralnie, BEZ „Pan/Pani”. Nie używaj form typu „Czy ma Pan lub Pani…”, bo brzmią sztywno.',
  'PYTANIA: Zadawaj pytania konstruktywne i konkretne — takie, które realnie posuwają rozmowę do umówienia terminu. Bez pustych, ogólnikowych pytań.',
  '  — Używaj bezosobowych, neutralnych zwrotów, które nie wskazują płci: „Czy to dobry moment na rozmowę?”, „Czy trening nadal jest interesujący?”, „Jaki budżet miesięczny wchodziłby w grę na treningi?”, „Ile treningów w tygodniu byłoby optymalnie?”, „Kiedy najlepiej byłoby zacząć?”, „Jaki termin pasuje najbardziej?”.',
  '  — Unikaj końcówek zdradzających płeć rozmówcy (nie mów „zainteresowany” ani „zainteresowana” — powiedz „czy trening jest interesujący”).',
  'NIE UŻYWAJ IMIENIA ROZMÓWCY: Nie zwracaj się do rozmówcy po imieniu. „Kuba” to imię trenera, nie rozmówcy.',
  'ODPOWIEDZI: Maksymalnie 1–2 krótkie zdania. Jedno pytanie na turę — potem CZEKAJ.',
  'SŁUCHAJ UWAŻNIE: Reaguj na to, co rozmówca powiedział ZA PIERWSZYM RAZEM. Nie zmuszaj do powtarzania. Jeśli ktoś już podał budżet miesięczny, liczbę treningów w tygodniu, dzień lub godzinę — zapamiętaj to i NIE pytaj o to ponownie.',
  'ABSOLUTNY ZAKAZ MILCZENIA: Gdy rozmówca poda JAKĄKOLWIEK liczbę, kwotę, dzień tygodnia lub godzinę — MUSISZ odpowiedzieć OD RAZU, za pierwszym razem. Nigdy nie ignoruj i nie czekaj na powtórzenie.',
  'PRZYKŁADY (reaguj natychmiast):',
  '  — „600 zł" / „sześćset" → „Sześćset złotych miesięcznie, rozumiem." + kolejne pytanie',
  '  — „2 razy" / „dwa razy w tygodniu" → „Dwa razy w tygodniu, zapisuję." + kolejne pytanie',
  '  — „poniedziałek" / „w poniedziałek" → „Poniedziałek, świetnie." + dopytaj o godzinę',
  '  — „o 14" / „o czternastej" → „O czternastej, zapisuję." (NIGDY „o czternaście:zero” ani „o 1400”)',
  '  — SAMA GODZINA bez słowa „godzina” („szesnastą", „szesnasta", „16", „szesnaście", „na szesnastą") → potraktuj jako godzinę 16:00 → „O szesnastej, zapisuję.” Nie proś o powtórzenie, nie mów że nie rozumiesz.',
  '  — „tak" / „jasne" / „ok" → natychmiast kontynuuj rozmowę',
  'KRÓTKIE ODPOWIEDZI: Na „tak”, „nie”, „jasne”, „ok”, liczby, dni tygodnia — ZAWSZE natychmiast odpowiedz i kontynuuj.',
  'WYMOWA GODZIN (BARDZO WAŻNE — sprawdź transkrypcje, tu były błędy):',
  '  — NIGDY nie mów godzin cyframi ani w formacie „10:00”, „14:00”, „1500”, „17:zero”, „czternaście:zero”, „dziesięć:zero”. To brzmi nienaturalnie i myli rozmówcę.',
  '  — ZAWSZE używaj poprawnej formy przymiotnikowej (dopełniacz): „o ósmej”, „o dziesiątej”, „o jedenastej”, „o trzynastej”, „o czternastej”, „o piętnastej”, „o szesnastej”, „o siedemnastej”.',
  '  — NIE myl liczebników: „czternaście” to liczba 14, a godzina 14:00 to „czternasta” / mówisz „o czternastej”. „Dziesięć” to 10, a godzina 10:00 to „dziesiąta” / mówisz „o dziesiątej”.',
  '  — Mapowanie slotów z grafiku (używaj WYŁĄCZNIE tych form):',
  '     8:00 → o ósmej | 9:00 → o dziewiątej | 10:00 → o dziesiątej | 11:00 → o jedenastej',
  '     13:00 → o trzynastej | 14:00 → o czternastej | 15:30 → o wpół do szesnastej',
  '     16:00 → o szesnastej | 17:00 → o siedemnastej',
  '  — Przykłady POPRAWNE: „Mamy wolne w poniedziałek o dziesiątej albo o czternastej.” / „Zapisałam na poniedziałek o czternastej.”',
  '  — Przykłady ZAKAZANE: „o 10:00”, „o 1400”, „o czternaście:zero”, „poniedziałek dziesięć:zero i 14”.',
  'GODZINY I TERMINY (WAŻNE): Gdy rozmówca podaje dzień i godzinę — powtórz w POPRAWNEJ formie mówionej, np. „Wtorek o czternastej, dobrze rozumiem?”. Jeśli rozmówca poda cyfry (np. „1500”, „14”) — przetłumacz na formę mówioną i potwierdź.',
  'SAMA GODZINA BEZ SŁOWA „GODZINA” (BARDZO WAŻNE — tu był błąd): Rozmówca CZĘSTO podaje samą godzinę jednym słowem, w różnej formie gramatycznej — MUSISZ to zrozumieć za PIERWSZYM razem i NIE prosić o powtórzenie. Traktuj wszystkie te formy jako tę samą godzinę:',
  '  — „szesnasta” / „szesnastą” / „szesnastej” / „szesnaście” / „16” → godzina 16:00 → potwierdź „O szesnastej”.',
  '  — „czternasta” / „czternastą” / „czternastej” / „czternaście” / „14” → 14:00 → „O czternastej”.',
  '  — „dziesiąta” / „dziesiątą” / „dziesiątej” / „dziesięć” / „10” → 10:00 → „O dziesiątej”.',
  '  — Analogicznie każda inna godzina. Jeśli w danym dniu pytałaś już o godzinę, a rozmówca rzuca samą liczbę/formę godziny — to JEST odpowiedź na to pytanie. Przyjmij ją, nie mów „nie rozumiem”.',
  'POTWIERDZANIE: Gdy rozmówca poda budżet lub termin — najpierw krótko potwierdź („Rozumiem, dwieście złotych miesięcznie”, „Wtorek o czternastej, super”), potem kolejne pytanie.',
  'GDY ROZMÓWCA SAM PODAJE TERMIN (BARDZO WAŻNE): Jeśli rozmówca sam zaproponuje konkretny dzień i godzinę, NAJPIERW sprawdź w grafiku poniżej:',
  '  — Jeśli ten termin jest WOLNY → od razu go POTWIERDŹ i zarezerwuj, np. „Poniedziałek o czternastej jest wolny, super — zapisuję!”. NIE wymieniaj wtedy żadnych innych slotów, NIE mów „Kuba ma dużo zajętych godzin” i NIE pytaj ponownie, którą godzinę wybiera. Termin już padł — po prostu go przyjmij.',
  '  — Jeśli ten termin jest ZAJĘTY → dopiero wtedy grzecznie powiedz, że akurat ta godzina jest zajęta, i zaproponuj 2–3 najbliższe WOLNE terminy.',
  '',
  'SCENARIUSZ ROZMOWY (kolejność — trzymaj się tej kolejności):',
  '0. RODO: powiedz „Informuję, że rozmowa jest nagrywana w celu umówienia treningu.” — zanim cokolwiek innego.',
  '1. Upewnij się, że rozmówca ma chwilę.',
  '2. Przypomnij, że dzwonisz w imieniu Kuby, bo rozmówca zapisał się przez formularz Meta na Facebooku na bezpłatny trening personalny.',
  '3. Zapytaj neutralnie, czy bezpłatna pierwsza sesja nadal jest interesująca.',
  '4. Zapytaj WYŁĄCZNIE o budżet MIESIĘCZNY na treningi — użyj sformułowania: „Jaki orientacyjny budżet miesięczny wchodziłby w grę na treningi personalne?” NIE pytaj ogólnie o budżet bez słowa „miesięczny”.',
  '5. Zapytaj ile treningów w tygodniu byłoby optymalnie — użyj sformułowania: „Ile treningów w tygodniu byłoby dla Ciebie optymalnie — na przykład raz, dwa razy, czy więcej?”',
  '6. Zapytaj, kiedy najlepiej byłoby zacząć i jaki termin pasuje na pierwszą darmową sesję.',
  '7. GRAFIK WOLNYCH TERMINÓW (do sprawdzania i proponowania — mów godziny formą mówioną, patrz WYMOWA GODZIN):',
  '   — Poniedziałek: wolne o dziesiątej i o czternastej (o dwunastej zajęte)',
  '   — Wtorek: wolne o jedenastej i o szesnastej (o dziewiątej i o trzynastej zajęte)',
  '   — Środa: wolne o siedemnastej (reszta dnia pełna)',
  '   — Czwartek: wolne o ósmej i o trzynastej',
  '   — Piątek: tylko o wpół do szesnastej wolne, reszta zajęta',
  '   Jeśli rozmówca SAM zaproponował termin, który jest na tej liście wolny — od razu go potwierdź (patrz reguła „GDY ROZMÓWCA SAM PODAJE TERMIN”) i NIE wymieniaj innych slotów.',
  '   Wolne terminy proponuj z własnej inicjatywy TYLKO wtedy, gdy rozmówca prosi o propozycję, nie ma pomysłu, albo podał godzinę, która jest zajęta. Wtedy podaj 2–3 najbliższe wolne sloty, nie całą listę.',
  '8. Ustal wybrany termin albo zaproponuj oddzwonienie od Kuby.',
  '9. NIE / brak czasu → podziękuj i zakończ.',
  '',
  'POTWIERDZENIE ZAPISU (BARDZO WAŻNE): Gdy termin jest ustalony, ZAWSZE wyraźnie powiedz, na co zapisałaś — podaj dzień tygodnia i godzinę, np. „Zapisałam Cię na poniedziałek o czternastej na bezpłatny trening u Kuby.” Nie kończ rozmowy od razu po „zapisuję” — daj rozmówcy chwilę, żeby to usłyszał. Dopiero potem podsumuj i pożegnaj się.',
  'STYL: Ciepło, profesjonalnie, konkretnie. Poczta głosowa → krótka wiadomość, że dzwoni asystentka Kuby w sprawie zapisu z Facebooka na darmowy trening.',
  'Wynik rozmowy: interested | not_interested | callback | voicemail | no_answer.',
  'ZAKOŃCZENIE: Po ustaleniu terminu — NAJPIERW wyraźnie powiedz, na jaki dzień i godzinę zapisałaś (patrz „POTWIERDZENIE ZAPISU”), potem krótkie podsumowanie, potem ZAWSZE powiedz dokładnie „Elo elo trzy dwa zero” — każdą cyfrę OSOBNO słownie: „trzy”, potem „dwa”, potem „zero”. NIGDY nie mów „320”, „trzysta dwadzieścia” ani „three twenty”. Następnie „Dziękuję, do usłyszenia” i dopiero wtedy endCall. NIE rozłączaj się szybko — rozmówca musi usłyszeć potwierdzenie zapisu.',
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
          phone_number: lead.phoneE164,
          campaign_name: lead.campaignName,
          leadgen_id: lead.leadgenId,
        },
        // RODO must be heard in full before the callee can interrupt.
        firstMessageMode: 'assistant-speaks-first',
        firstMessageInterruptionsEnabled: false,
        firstMessage:
          'Informuję, że rozmowa jest nagrywana w celu umówienia treningu. Dzień dobry, z tej strony Morgan, asystentka Kuby, trenera personalnego. Dzwonię w sprawie formularza z kampanii {{campaign_name}} na Facebooku — chodzi o bezpłatny trening personalny. Czy to dobry moment na krótką rozmowę?',
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.65,
          maxTokens: 130,
          messages: [{ role: 'system', content: polishSystemPrompt }],
          tools: [{ type: 'endCall' }],
        },
        // Hard limit — call ends at maxDuration (default 5 min). Hooks warn and
        // gracefully hang up a few seconds before the cutoff.
        maxDurationSeconds: maxDuration,
        endCallMessage: 'Elo elo trzy dwa zero. Dziękuję za rozmowę, do usłyszenia!',
        endCallPhrases: ['elo elo trzy dwa zero', 'elo elo 320', 'do usłyszenia', 'miłego dnia', 'dziękuję za rozmowę'],
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
              { type: 'say', exact: 'Elo elo trzy dwa zero. Dziękuję za rozmowę, muszę kończyć — do usłyszenia!' },
              { type: 'tool', tool: { type: 'endCall' } },
            ],
          },
        ],
        transcriber: {
          provider: 'deepgram',
          // nova-3 obsługuje polski i ma Keyterm Prompting — dużo lepiej łapie
          // liczby, kwoty, dni tygodnia i godziny niż nova-2.
          model: 'nova-3',
          language: 'pl',
          // 220 ms utterance-end — krótkie potwierdzenia („tak”, „jasne”) są
          // domykane szybciej, dzięki czemu bot odpowiada od razu.
          endpointing: 220,
          smartFormat: true,
          // keyterm (nova-3) — podbija rozpoznawanie fraz krytycznych dla umawiania.
          keyterm: [
            // Krótkie potwierdzenia/odmowy — najczęstsze, muszą być łapane pewnie.
            'tak', 'nie', 'jasne', 'ok', 'okej', 'dobra', 'dobrze', 'zgoda', 'pewnie', 'jasne że tak', 'raczej nie', 'chętnie',
            'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela',
            'złotych', 'budżet', 'miesięczny', 'miesięcznie', 'tygodniu', 'treningów', 'raz w tygodniu', 'dwa razy',
            'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset',
            'o ósmej', 'o dziesiątej', 'o jedenastej', 'o dwunastej', 'o trzynastej', 'o czternastej',
            'o piętnastej', 'o szesnastej', 'o siedemnastej', 'wpół do szesnastej',
            // Samodzielne formy godzin (biernik/mianownik) — padają bez słowa „o”.
            'ósma', 'dziewiąta', 'dziesiąta', 'jedenasta', 'dwunasta', 'trzynasta', 'czternasta',
            'piętnasta', 'szesnasta', 'siedemnasta',
            'ósmą', 'dziewiątą', 'dziesiątą', 'jedenastą', 'dwunastą', 'trzynastą', 'czternastą',
            'piętnastą', 'szesnastą', 'siedemnastą',
            'elo elo trzy dwa zero', 'trzy', 'dwa', 'zero',
          ],
        },
        voice: {
          // ElevenLabs Flash v2.5 — wcześniejsza (preferowana) wersja głosu.
          // Konfigurowalne przez .env (VAPI_VOICE_*).
          provider: (env.VAPI_VOICE_PROVIDER || '11labs'),
          model: (env.VAPI_VOICE_MODEL || 'eleven_flash_v2_5'),
          voiceId: (env.VAPI_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'),
          stability: 0.4,
          similarityBoost: 0.8,
          speed: 0.94,
          useSpeakerBoost: true,
          optimizeStreamingLatency: 4,
        },
        // waitSeconds 0.9 — chwilowa pauza po odebraniu, żeby pierwsze słowo
        // („Cześć…”) nie było ucięte zanim kanał audio się ustabilizuje.
        startSpeakingPlan: {
          waitSeconds: 0.4,
          smartEndpointingPlan: { provider: 'vapi' },
          transcriptionEndpointingPlan: {
            onPunctuationSeconds: 0.1,
            // Krótkie odpowiedzi („tak”, „jasne”, „ok”) — bardzo szybka reakcja,
            // żeby bot nie czekał w martwej ciszy po jednowyrazowej odpowiedzi.
            onNoPunctuationSeconds: 0.5,
            // Po liczbie krótkie czekanie — model dokończy „400 zł” / „o 14”,
            // ale odpowie za pierwszym razem, bez zbędnej zwłoki.
            onNumberSeconds: 1.0,
          },
        },
        stopSpeakingPlan: {
          numWords: 2,
          voiceSeconds: 0.3,
          backoffSeconds: 0.6,
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
                  'Jesteś asystentem tworzącym krótkie notatki CRM po polsku. Podsumuj rozmowę w 2–3 zdaniach: zapis z Meta, zainteresowanie darmową sesją, budżet miesięczny na treningi, liczba treningów w tygodniu, wybrany lub preferowany termin pierwszej sesji.',
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
                budget: { type: 'string', description: 'Orientacyjny budżet MIESIĘCZNY na treningi personalne, jeśli padł (np. „400 zł miesięcznie”).' },
                sessions_per_week: { type: 'string', description: 'Preferowana liczba treningów w tygodniu, jeśli padła (np. „2 razy”).' },
                preferred_session_date: { type: 'string', description: 'Preferowany termin rozpoczęcia / wybrany slot treningu.' },
                notes: { type: 'string', description: 'Krótka notatka dla trenera.' },
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
  const reqTimeout = 45000;
  const audioBuf = await helpers.httpRequest({
    method: 'GET',
    url: downloadUrl,
    encoding: 'arraybuffer',
    timeout: reqTimeout,
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
    timeout: reqTimeout,
  });

  const fileUrl = (uploadJson.message && uploadJson.message.file_url) || uploadJson.file_url || '';
  const permanentUrl = fileUrl.startsWith('http') ? fileUrl : publicBase + fileUrl;

  await helpers.httpRequest({
    method: 'PUT',
    url: apiBase + '/api/resource/Lead/' + encodeURIComponent(leadName),
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: { custom_call_recording_url: permanentUrl },
    json: true,
    timeout: reqTimeout,
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
          '={{ { "status": "processed", "lead": (($("Upsert Frappe Lead").first().json.data && $("Upsert Frappe Lead").first().json.data.name) || null) } }}',
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
      main: [[{ node: 'Ack Vapi', type: 'main', index: 0 }]],
    },
    // Ack Vapi FIRST (Vapi gets 200 immediately), then upload WAV in background.
    // Previously Attach ran before Ack and blocked/hung n8n on large downloads.
    'Ack Vapi': {
      main: [[{ node: 'Attach Recording to Frappe', type: 'main', index: 0 }]],
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
