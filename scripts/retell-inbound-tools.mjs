/**
 * Shared Retell inbound tool patches — single source of truth for tool descriptions
 * that must stay in sync between push-inbound-prompt.mjs and sync-retell-urls.mjs.
 */

/** Safe end_call description — the default Retell text caused silent hangups on reschedule intent. Max 1024 chars. */
export const END_CALL_TOOL_DESCRIPTION = [
  'KIEDY: po „Czy mogę jeszcze pomóc?” klient kończy (nie / dzięki / to wszystko / nie mam pytań) LUB sam się pożegnał (pa, do widzenia) LUB odmawia rozmowy.',
  '',
  'JAK: w jednej turze powiedz TYLKO „Do usłyszenia.” i od razu end_call. NIE czekaj na odpowiedź.',
  'Jeśli klient powtórzy „do usłyszenia” po Twoim pożegnaniu → end_call BEZ słów (cisza).',
  'ZAKAZ: „rozłączam rozmowę”, „rozłączam”, „kończę rozmowę” — klient tego nie słyszy.',
  '',
  'NIE rozłączaj gdy: umawianie/odwołanie/przełożenie, klient podał intencję, po book/cancel/reschedule bez pytania o dalszą pomoc.',
  '„No”, „dobra”, „tak” to NIE pożegnanie.',
].join('\n');

export const LIST_MY_APPOINTMENTS_TOOL_DESCRIPTION = [
  'Pobiera nadchodzace wizyty klienta (appointments[]: label, slot_start).',
  'WYWOŁAJ NATYCHMIAST przy odwołaniu/przełożeniu — przed pytaniem o nowy termin.',
  'Gdy klient poda samą godzinę (np. 18:00) — dopasuj JEDNĄ wizytę z listy po label.',
  'ZAKAZ pytania „z którego dnia?” jeśli godzina jednoznaczna. Zapamiętaj appointments[] na całą rozmowę.',
].join(' ');

export const RESCHEDULE_APPOINTMENT_TOOL_DESCRIPTION = [
  'Przekłada wizytę klienta na nowy termin w Google Calendar.',
  '',
  'KIEDY WYWOŁAĆ:',
  '• Po list_my_appointments — klient wskazał starą wizytę (godzina/dzień z appointments[]). Gdy poda samą godzinę i jest jedna pasująca wizyta — NIE pytaj z którego dnia.',
  '• Po check_availability — nowy termin jest wolny.',
  '• old_slot_start → skopiuj slot_start z wybranej pozycji appointments[]; new_slot_start → skopiuj start z slots[].',
  '',
  'PO SUKCESIE (successful:true lub success:true — nawet gdy content pusty):',
  '1. „Gotowe, przekładam Cię na [label].”',
  '2. „Czy mogę jeszcze jakoś pomóc?” — nie kończ rozmowy bez tego pytania.',
].join('\n');

export const BOOK_APPOINTMENT_TOOL_DESCRIPTION = [
  'Rezerwuje NOWY termin treningu w Google Calendar.',
  '',
  'KIEDY WYWOŁAĆ:',
  '• Klient chce umówić / zapisać się na trening.',
  '• NIE używaj przy przełożeniu, przesunięciu ani odwołaniu wizyty.',
  '• slot_start → skopiuj start z wybranego obiektu slots[] z check_availability.',
  '',
  'PO SUKCESIE (successful:true lub success:true — nawet gdy content pusty):',
  '1. „Gotowe, zapisałam Cię na [label].”',
  '2. „Czy mogę jeszcze jakoś pomóc?” — nie kończ rozmowy bez tego pytania.',
].join('\n');

export const CANCEL_APPOINTMENT_TOOL_DESCRIPTION = [
  'Odwołuje wizytę klienta w Google Calendar.',
  '',
  'KIEDY WYWOŁAĆ:',
  '• Po list_my_appointments — klient potwierdził wizytę i podał **imię i nazwisko** (weryfikacja).',
  '• slot_start → skopiuj DOKŁADNIE pole slot_start z appointments[].',
  '',
  'PO SUKCESIE (successful:true lub success:true — nawet gdy content pusty):',
  '1. „Gotowe, odwołałam wizytę.”',
  '2. „Czy mogę jeszcze jakoś pomóc?” — nie kończ rozmowy bez tego pytania.',
].join('\n');

export function patchEndCallTool(tools) {
  return (tools ?? []).map((tool) => {
    if (tool.type !== 'end_call') return tool;
    return {
      ...tool,
      description: END_CALL_TOOL_DESCRIPTION,
      speak_after_execution: false,
      speak_during_execution: false,
      execution_message_type: 'static_text',
      execution_message_description: ' ',
    };
  });
}

export function calendarTool(base, name, description, url, parameters, executionMessage, options = {}) {
  return {
    type: 'custom',
    name,
    description,
    // Tool stays SILENT. The LLM says the wait phrase in one fluid sentence BEFORE
    // the call (per prompt), then speaks the result. speak_during_execution:true was
    // cutting the wait phrase mid-word ("sprawdzam / Twoje wizyty").
    speak_during_execution: false,
    speak_after_execution: false,
    method: 'POST',
    url,
    parameters,
  };
}
