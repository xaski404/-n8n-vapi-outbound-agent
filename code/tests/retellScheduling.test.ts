import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalendarEvent,
  buildEventsListUrl,
  configFromEnv,
  defaultStudioConfig,
  findMatchingCalendarEvent,
  formatAvailabilityResponse,
  formatListAppointmentsResponse,
  formatSlotStartForAgent,
  filterSlotsByTimeOfDay,
  getAvailableSlots,
  parseAvailabilityQuery,
  parseCalendarBusyBlocks,
  parsePreferredDate,
  parsePreferredDays,
  parsePreferredTime,
  parseRetellToolRequest,
  parseTimeOfDay,
  resolveAgentSlotStart,
  resolveFutureSlotStart,
  resolveCancelSlotStart,
  slotLabelFromIso,
  validateBookingSlot,
} from '../retellScheduling';

describe('retellScheduling', () => {
  const config = defaultStudioConfig({ openHour: 9, closeHour: 12, workDays: [1], maxSlotsReturned: 3 });

  it('parseRetellToolRequest extracts caller from inbound call', () => {
    const req = parseRetellToolRequest({
      name: 'check_availability',
      args: { preferred_day: 'czwartek' },
      call: {
        direction: 'inbound',
        from_number: '+48100999888',
        call_id: 'call-123',
        retell_llm_dynamic_variables: { full_name: 'Anna Kowalska' },
      },
    });

    assert.equal(req.functionName, 'check_availability');
    assert.equal(req.callerPhone, '+48100999888');
    assert.equal(req.callerName, 'Anna Kowalska');
    assert.equal(req.args.preferred_day, 'czwartek');
  });

  it('parsePreferredDays handles multiple Polish weekdays', () => {
    assert.deepEqual(parsePreferredDays('środę albo wtorek')?.sort(), [2, 3]);
    assert.deepEqual(parsePreferredDays('wtorek'), [2]);
    assert.equal(parsePreferredDays('nieznany'), undefined);
  });

  it('parsePreferredDate handles ISO and Polish month names', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    assert.equal(parsePreferredDate('2026-08-28', now), '2026-08-28');
    assert.equal(parsePreferredDate('28 sierpnia', now), '2026-08-28');
    assert.equal(parsePreferredDate('28.08.2026', now), '2026-08-28');
  });

  it('parsePreferredDate handles bare day number', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    assert.equal(parsePreferredDate('21', now), '2026-08-21');
  });

  it('parseAvailabilityQuery extracts day number from piątek 21', () => {
    const q = parseAvailabilityQuery('piątek 21', undefined, new Date('2026-08-19T10:00:00+02:00'));
    assert.equal(q.preferredDateYmd, '2026-08-21');
    assert.deepEqual(q.preferredDows, [5]);
  });

  it('parseTimeOfDay maps Polish phrases', () => {
    assert.equal(parseTimeOfDay('rano'), 'rano');
    assert.equal(parseTimeOfDay('po południu'), 'po_poludniu');
    assert.equal(parseTimeOfDay('wieczorem'), 'wieczorem');
  });

  it('parsePreferredTime maps clock times', () => {
    assert.deepEqual(parsePreferredTime('12:00'), { hour: 12, minute: 0 });
    assert.deepEqual(parsePreferredTime('15'), { hour: 15, minute: 0 });
    assert.deepEqual(parsePreferredTime('dwunasta'), { hour: 12, minute: 0 });
    assert.equal(parsePreferredTime('rano'), undefined);
  });

  it('formatAvailabilityResponse returns exact_match for requested hour', () => {
    const slots = [
      { start: '2026-08-26T08:00:00+02:00', end: '2026-08-26T09:00:00+02:00', labelPl: 'środa, 26 sierpnia 08:00' },
      { start: '2026-08-26T12:00:00+02:00', end: '2026-08-26T13:00:00+02:00', labelPl: 'środa, 26 sierpnia 12:00' },
      { start: '2026-08-26T17:00:00+02:00', end: '2026-08-26T18:00:00+02:00', labelPl: 'środa, 26 sierpnia 17:00' },
    ];
    const hit = formatAvailabilityResponse(slots, { preferredTime: { hour: 12, minute: 0 } });
    assert.equal(hit.exact_match, true);
    assert.equal((hit.slots as unknown[]).length, 1);
    assert.match(hit.message as string, /jest wolny/);

    const miss = formatAvailabilityResponse(slots, { preferredTime: { hour: 10, minute: 0 } });
    assert.equal(miss.exact_match, false);
    assert.match(miss.message as string, /brak wolnego terminu/i);
  });

  it('formatAvailabilityResponse falls back to same-day slots when morning is full', () => {
    const slots = [
      { start: '2026-08-21T14:00:00+02:00', end: '2026-08-21T15:00:00+02:00', labelPl: 'piątek, 21 sierpnia 14:00' },
      { start: '2026-08-21T15:00:00+02:00', end: '2026-08-21T16:00:00+02:00', labelPl: 'piątek, 21 sierpnia 15:00' },
    ];
    const resp = formatAvailabilityResponse(slots, { preferredTimeOfDay: 'rano' });
    assert.equal(resp.preferred_period_available, false);
    assert.equal((resp.slots as unknown[]).length, 2);
    assert.match(String(resp.message), /TEGO SAMEGO dnia/i);
    assert.equal(resp.same_day_alternatives, true);
  });

  it('filterSlotsByTimeOfDay keeps afternoon hours only', () => {
    const slots = [
      { start: '2026-08-21T09:00:00+02:00', end: '2026-08-21T10:00:00+02:00', labelPl: '9' },
      { start: '2026-08-21T13:00:00+02:00', end: '2026-08-21T14:00:00+02:00', labelPl: '13' },
    ];
    const afternoon = filterSlotsByTimeOfDay(slots, 'po_poludniu', 'Europe/Warsaw');
    assert.equal(afternoon.length, 1);
    assert.equal(afternoon[0].labelPl, '13');
  });

  it('parseAvailabilityQuery handles kolejny piątek', () => {
    const q = parseAvailabilityQuery('kolejny piątek', undefined, new Date('2026-08-19T10:00:00+02:00'));
    assert.deepEqual(q.preferredDows, [5]);
    assert.equal(q.skipOccurrences, 1);
  });

  it('getAvailableSlots returns only requested calendar date', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    const query = parseAvailabilityQuery(undefined, '28 sierpnia', now);
    const slots = getAvailableSlots(defaultStudioConfig(), [], now, undefined, query);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.match(slot.labelPl.toLowerCase(), /28 sierpnia/);
      assert.match(slot.labelPl.toLowerCase(), /piątek/);
    }
  });

  it('getAvailableSlots skips first matching weekday for kolejny piątek', () => {
    const now = new Date('2026-08-19T10:00:00+02:00'); // Wednesday
    const query = parseAvailabilityQuery('kolejny piątek', undefined, now);
    const slots = getAvailableSlots(defaultStudioConfig(), [], now, undefined, query);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.match(slot.labelPl.toLowerCase(), /28 sierpnia/);
    }
    assert.doesNotMatch(slots[0].labelPl.toLowerCase(), /21 sierpnia/);
  });

  it('getAvailableSlots filters by multiple preferred days', () => {
    const monday = new Date('2026-08-17T07:00:00+02:00');
    const slots = getAvailableSlots(defaultStudioConfig(), [], monday, 'środę albo wtorek');
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.match(slot.labelPl.toLowerCase(), /wtorek|środa/);
    }
  });

  it('getAvailableSlots returns correct weekday when server runs in UTC (Docker n8n)', () => {
    const now = new Date('2026-08-22T23:16:08.615Z');
    const query = parseAvailabilityQuery('środa', undefined, now);
    const slots = getAvailableSlots(defaultStudioConfig(), [], now, undefined, query);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.match(slot.labelPl.toLowerCase(), /środa/);
      assert.doesNotMatch(slot.labelPl.toLowerCase(), /wtorek/);
    }
  });

  it('getAvailableSlots maps piątek to Friday slots in UTC environment', () => {
    const now = new Date('2026-08-22T23:16:08.615Z');
    const query = parseAvailabilityQuery('piątek', undefined, now);
    const slots = getAvailableSlots(defaultStudioConfig(), [], now, undefined, query);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.match(slot.labelPl.toLowerCase(), /piątek/);
    }
  });

  it('getAvailableSlots excludes busy blocks', () => {
    const monday = new Date('2026-08-17T07:00:00+02:00'); // Monday
    const busyStart = new Date('2026-08-17T09:00:00+02:00');
    const busyEnd = new Date('2026-08-17T10:00:00+02:00');
    const busy = [{ start: busyStart.toISOString(), end: busyEnd.toISOString() }];
    const slots = getAvailableSlots(config, busy, monday);

    assert.ok(slots.length > 0);
    const overlapsBusy = slots.some((s) => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      return start < busyEnd && end > busyStart;
    });
    assert.equal(overlapsBusy, false);
  });

  it('formatAvailabilityResponse returns Polish message', () => {
    const resp = formatAvailabilityResponse([
      { start: '2026-08-18T10:00:00+02:00', end: '2026-08-18T11:00:00+02:00', labelPl: 'wtorek, 18 sierpnia, 10:00' },
    ]);
    assert.equal(resp.available, true);
    assert.match(String(resp.message), /wtorek, 18 sierpnia/);
  });

  it('validateBookingSlot rejects occupied slots', () => {
    const slot = '2026-08-20T10:00:00+02:00';
    const now = new Date('2026-08-14T08:00:00+02:00');
    const busy = [{ start: '2026-08-20T10:00:00+02:00', end: '2026-08-20T11:00:00+02:00' }];
    const result = validateBookingSlot(slot, defaultStudioConfig(), busy, now);
    assert.equal(result.valid, false);
    assert.match(String(result.error), /zajęty/);
  });

  it('buildCalendarEvent includes conversation context', () => {
    const event = buildCalendarEvent(
      {
        slotStart: '2026-08-20T10:00:00+02:00',
        customerName: 'Jan Nowak',
        customerPhone: '+48111222333',
        direction: 'inbound',
        goal: 'redukcja masy',
        experienceLevel: 'początkujący',
        sessionsPerWeek: '2',
        conversationSummary: 'Klient chce trenować wieczorem, pierwszy raz na siłowni.',
        callId: 'call-abc',
      },
      defaultStudioConfig(),
    );
    assert.match(event.summary, /^Trening — Jan Nowak$/);
    assert.match(event.description, /\+48111222333/);
    assert.match(event.description, /redukcja masy/);
    assert.match(event.description, /Podsumowanie rozmowy/);
    assert.equal(event.extendedProperties?.private?.customer_phone, '+48111222333');
    assert.equal(event.extendedProperties?.private?.booked_slot, '2026-08-20T10:00:00+02:00');
  });

  it('resolveCancelSlotStart snaps far-future same weekday to nearest (LLM wrong month)', () => {
    const now = new Date('2026-08-19T17:00:00+02:00');
    const resolved = resolveCancelSlotStart('2026-09-11T11:00:00.000Z', now, 'Europe/Warsaw');
    assert.match(resolved, /2026-08-21T11:00:00.000Z/);
  });

  it('findMatchingCalendarEvent rejects wrong-day event even if only candidate', () => {
    const now = new Date('2026-08-19T17:00:00+02:00');
    const list = {
      items: [
        {
          id: 'evt-sep10',
          start: { dateTime: '2026-09-10T12:00:00.000Z' },
          extendedProperties: { private: { customer_phone: '+48111222333' } },
        },
      ],
    };
    const match = findMatchingCalendarEvent(
      list,
      '+48111222333',
      '2026-08-21T11:00:00.000Z',
      'Jakub Łaski',
      now,
      'Europe/Warsaw',
    );
    assert.equal(match, null);
  });

  it('resolveFutureSlotStart rolls past wrong-year dates to nearest future weekday', () => {
    const now = new Date('2026-08-19T10:41:29+02:00');
    const resolved = resolveFutureSlotStart('2026-03-26T16:00:00+01:00', now, 'Europe/Warsaw');
    const resolvedDate = new Date(resolved);
    assert.ok(resolvedDate.getTime() >= now.getTime());
    assert.match(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(resolvedDate),
      /Thu/,
    );
    assert.equal(
      parseInt(
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(
          resolvedDate,
        ),
        10,
      ),
      16,
    );
  });

  it('findMatchingCalendarEvent picks event by phone and slot', () => {
    const list = {
      items: [
        {
          id: 'evt-1',
          description: 'Telefon: +48111222333',
          start: { dateTime: '2026-08-20T10:00:00+02:00' },
          extendedProperties: { private: { customer_phone: '+48111222333' } },
        },
        {
          id: 'evt-2',
          description: 'Telefon: +48999888777',
          start: { dateTime: '2026-08-21T10:00:00+02:00' },
        },
      ],
    };
    const match = findMatchingCalendarEvent(
      list,
      '+48111222333',
      '2026-08-20T10:00:00+02:00',
      'Jakub Łaski',
      new Date('2026-08-19T12:00:00+02:00'),
    );
    assert.equal(match?.id, 'evt-1');
  });

  it('findMatchingCalendarEvent matches when slot aligns within tolerance', () => {
    const now = new Date('2026-08-19T10:41:29+02:00');
    const list = {
      items: [
        {
          id: 'evt-jakub',
          summary: 'Trening próbny — Jakub Łaski',
          description: 'Telefon: +48799839938',
          start: { dateTime: '2026-08-21T16:00:00+02:00' },
          extendedProperties: { private: { customer_phone: '+48799839938' } },
        },
      ],
    };
    const match = findMatchingCalendarEvent(
      list,
      '+48799839938',
      '2026-08-21T14:00:00.000Z',
      'Jakub Łaski',
      now,
      'Europe/Warsaw',
    );
    assert.equal(match?.id, 'evt-jakub');
  });

  it('buildEventsListUrl fetches broad list for client-side phone match', () => {
    const now = new Date('2026-08-19T10:41:29+02:00');
    const url = buildEventsListUrl('primary', '+48799839938', undefined, defaultStudioConfig(), now);
    assert.match(url, /calendars/);
    assert.doesNotMatch(url, /[?&]q=/);
    assert.match(url, /maxResults=250/);
    assert.match(url, /fields=/);
  });

  it('buildEventsListUrl uses forward window when slot is in the past', () => {
    const now = new Date('2026-08-19T10:41:29+02:00');
    const url = buildEventsListUrl(
      'primary',
      '+48799839938',
      '2026-03-26T16:00:00+01:00',
      defaultStudioConfig(),
      now,
    );
    assert.match(url, /calendars/);
    assert.doesNotMatch(url, /[?&]q=/);
    const timeMin = decodeURIComponent(url.match(/timeMin=([^&]+)/)?.[1] ?? '');
    const timeMax = decodeURIComponent(url.match(/timeMax=([^&]+)/)?.[1] ?? '');
    assert.ok(new Date(timeMax).getTime() >= new Date(timeMin).getTime());
  });

  it('formatListAppointmentsResponse matches phone stored without country prefix', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    const cfg = defaultStudioConfig();
    const list = formatListAppointmentsResponse(
      {
        items: [
          {
            id: 'evt-local',
            summary: 'Trening — Jan',
            start: { dateTime: '2026-08-21T11:00:00+02:00' },
            description: 'Telefon: 799839938',
          },
        ],
      },
      '+48799839938',
      undefined,
      cfg,
      now,
    );
    assert.equal(list.found, true);
    assert.equal((list.appointments as unknown[]).length, 1);
  });

  it('buildCalendarEvent uses trial label for outbound', () => {
    const event = buildCalendarEvent(
      { slotStart: '2026-08-20T10:00:00+02:00', customerName: 'Jan', customerPhone: '+48111222333', direction: 'outbound' },
      defaultStudioConfig(),
    );
    assert.match(event.summary, /Trening próbny/);
  });

  it('formatListAppointmentsResponse returns upcoming labels', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    const cfg = defaultStudioConfig();
    const list = formatListAppointmentsResponse(
      {
        items: [
          {
            id: 'evt1',
            summary: 'Trening — Jan',
            start: { dateTime: '2026-08-21T11:00:00+02:00' },
            extendedProperties: { private: { customer_phone: '+48111222333' } },
          },
          {
            id: 'evt2',
            summary: 'Trening — Jan',
            start: { dateTime: '2026-08-10T11:00:00+02:00' },
            extendedProperties: { private: { customer_phone: '+48111222333' } },
          },
        ],
      },
      '+48111222333',
      'Jan Kowalski',
      cfg,
      now,
    );
    assert.equal(list.found, true);
    assert.equal((list.appointments as unknown[]).length, 1);
    assert.ok((list.appointments as { label: string }[])[0].label);
  });

  it('formatListAppointmentsResponse groups many same-day appointments', () => {
    const now = new Date('2026-08-19T10:00:00+02:00');
    const cfg = defaultStudioConfig();
    const base = '2026-08-26T';
    const hours = ['08:00', '09:00', '10:00', '14:00', '17:00'];
    const list = formatListAppointmentsResponse(
      {
        items: hours.map((h, i) => ({
          id: 'evt' + i,
          summary: 'Trening — Jan',
          start: { dateTime: base + h + ':00+02:00' },
          extendedProperties: { private: { customer_phone: '+48111222333' } },
        })),
      },
      '+48111222333',
      'Jan Kowalski',
      cfg,
      now,
    );
    assert.equal(list.found, true);
    assert.match(list.message as string, /5 wizyt w .* — podaj godzinę/);
  });

  it('formatListAppointmentsResponse keeps Friday when many Wednesday test slots exist', () => {
    const now = new Date('2026-08-22T10:00:00+02:00');
    const cfg = defaultStudioConfig();
    const phone = '+48799839938';
    const items = [
      '2026-08-26T08:00:00+02:00',
      '2026-08-26T09:00:00+02:00',
      '2026-08-26T10:00:00+02:00',
      '2026-08-26T14:00:00+02:00',
      '2026-08-26T17:00:00+02:00',
      '2026-08-28T15:00:00+02:00',
    ].map((iso, i) => ({
      id: 'evt' + i,
      summary: 'Trening — Jakub Łaski',
      start: { dateTime: iso },
      extendedProperties: { private: { customer_phone: phone } },
    }));
    const list = formatListAppointmentsResponse({ items }, phone, 'Jakub Łaski', cfg, now);
    const labels = (list.appointments as { label: string }[]).map((a) => a.label);
    assert.ok(labels.some((l) => /piątek.*15:00/.test(l)), `expected Friday 15:00 in ${labels.join('; ')}`);
  });

  it('slotLabelFromIso formats Polish label', () => {
    const label = slotLabelFromIso('2026-08-21T11:00:00+02:00', 'Europe/Warsaw');
    assert.match(label, /piątek|21|sierpnia|11/i);
  });

  it('configFromEnv reads studio settings', () => {
    const cfg = configFromEnv({
      STUDIO_TIMEZONE: 'Europe/Warsaw',
      STUDIO_OPEN_HOUR: '7',
      STUDIO_CLOSE_HOUR: '21',
      BOOKING_DURATION_MINUTES: '45',
    });
    assert.equal(cfg.openHour, 7);
    assert.equal(cfg.durationMinutes, 45);
  });

  it('formatSlotStartForAgent uses local hour in ISO offset form', () => {
    const formatted = formatSlotStartForAgent('2026-08-28T17:00:00.000Z', 'Europe/Warsaw');
    assert.match(formatted, /2026-08-28T19:00:00\+0?2:00/);
  });

  it('resolveAgentSlotStart fixes LLM UTC mistake (19:00 chosen, 18:00Z sent → 19:00 local)', () => {
    const cfg = defaultStudioConfig({ openHour: 8, closeHour: 20, workDays: [1, 2, 3, 4, 5] });
    const now = new Date('2026-08-22T10:00:00+02:00');
    const busy: { start: string; end: string }[] = [];
    const wrongIso = '2026-08-28T18:00:00.000Z'; // reads as 20:00 Warsaw
    const fixed = resolveAgentSlotStart(wrongIso, cfg, busy, now);
    const label = slotLabelFromIso(fixed, 'Europe/Warsaw');
    assert.match(label, /19:00|19\.00/);
  });

  it('formatAvailabilityResponse slots start hour matches label hour', () => {
    const cfg = defaultStudioConfig({ openHour: 17, closeHour: 20, workDays: [5], maxSlotsReturned: 5 });
    const now = new Date('2026-08-22T10:00:00+02:00');
    const slots = getAvailableSlots(cfg, [], now, undefined, { preferredDateYmd: '2026-08-28' });
    const resp = formatAvailabilityResponse(slots, { timezone: 'Europe/Warsaw' }) as {
      slots: { start: string; label: string }[];
    };
    const evening = resp.slots.find((s) => s.label.includes('19:00'));
    assert.ok(evening);
    assert.match(evening!.start, /T19:00:00/);
  });

  it('parseCalendarBusyBlocks extracts busy intervals', () => {
    const blocks = parseCalendarBusyBlocks(
      { calendars: { primary: { busy: [{ start: 'a', end: 'b' }] } } },
      'primary',
    );
    assert.deepEqual(blocks, [{ start: 'a', end: 'b' }]);
  });
});
