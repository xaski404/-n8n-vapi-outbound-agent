/**
 * Shared Retell inbound tool patches — single source of truth for tool descriptions
 * that must stay in sync between push-inbound-prompt.mjs and sync-retell-urls.mjs.
 */

/** Safe end_call description — the default Retell text caused silent hangups on reschedule intent. Max 1024 chars. */
export const END_CALL_TOOL_DESCRIPTION = [
  'KIEDY MOŻESZ rozłączyć:',
  '1. Powiedziałaś „Do usłyszenia” i klient nie ma więcej pytań.',
  '2. Klient wyraźnie się pożegnał: do widzenia, pa, do usłyszenia.',
  '3. Klient odmawia rozmowy: pomyłka, nie dzwoniłem, nie interesuje, nie mam czasu.',
  '',
  'KIEDY NIE WOLNO rozłączać:',
  '• Klient chce umówić, odwołać lub przełożyć wizytę.',
  '• Klient dopiero podał intencję — najpierw obsłuż (list / book / cancel / reschedule).',
  '• Po udanym book, cancel lub reschedule — najpierw zapytaj: „Czy mogę jeszcze jakoś pomóc?”',
  '• „No”, „dobra”, „tak”, „dzień dobry” to NIE pożegnanie.',
  '',
  'ZAWSZE przed end_call powiedz pożegnanie głosem.',
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
      execution_message_type: 'prompt',
      execution_message_description: '',
    };
  });
}

export function calendarTool(base, name, description, url, parameters, executionMessage, options = {}) {
  const mutating = options.mutating === true;
  return {
    type: 'custom',
    name,
    description,
    speak_during_execution: mutating ? false : true,
    speak_after_execution: mutating ? false : true,
    execution_message_type: mutating ? 'prompt' : 'static_text',
    execution_message_description: mutating ? '' : executionMessage,
    method: 'POST',
    url,
    parameters,
  };
}
