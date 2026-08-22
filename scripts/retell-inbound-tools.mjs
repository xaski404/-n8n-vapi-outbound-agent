/**
 * Shared Retell inbound tool patches — single source of truth for tool descriptions
 * that must stay in sync between push-inbound-prompt.mjs and sync-retell-urls.mjs.
 */

/** Safe end_call description — the default Retell text caused silent hangups on reschedule intent. */
export const END_CALL_TOOL_DESCRIPTION = [
  'Rozlacz TYLKO gdy: (1) powiedzialas "Do uslyzenia", klient nie ma pytan; (2) klient sie pozegnal (do widzenia, pa); (3) odmawia rozmowy (pomylka, nie dzwonilem).',
  'ZAKAZ end_call gdy: klient chce umowic/odwolac/przelozyc; dopiero podal intencje; brak list/book/cancel/reschedule; po udanym book/cancel/reschedule BEZ pytania "Czy moge jeszcze pomoc?"; klient mowi no/dobra/tak/dzien dobry.',
  'Przed end_call zawsze pożegnaj glosem.',
].join(' ');

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
