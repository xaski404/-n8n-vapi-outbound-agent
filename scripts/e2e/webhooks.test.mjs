import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  N8N_BASE_URL,
  isN8nHealthy,
  postWebhook,
  loadFixture,
  buildRetellCallAnalyzedPayload,
  buildRetellInboundCallAnalyzedPayload,
  buildRetellCheckAvailabilityPayload,
  buildRetellBookAppointmentPayload,
  buildRetellListAppointmentsPayload,
  buildRetellCancelAppointmentPayload,
  buildRetellRescheduleAppointmentPayload,
  buildMetaLeadPayload,
  uniqueE164,
} from './helpers.mjs';

const n8nUp = await isN8nHealthy();
const dispatchRetell = process.env.E2E_DISPATCH_RETELL === '1';
const calendarConfigured = process.env.E2E_CALENDAR === '1';

describe('E2E — n8n webhooks', { skip: n8nUp ? false : 'n8n not reachable at ' + N8N_BASE_URL }, () => {
  it('healthz responds OK', async () => {
    const response = await fetch(`${N8N_BASE_URL}/healthz`);
    assert.equal(response.status, 200);
  });

  it('Flow B: retell-call-analyzed processes call_analyzed event', async () => {
    const phone = uniqueE164();
    const payload = buildRetellCallAnalyzedPayload({ phone, fullName: 'E2E Retell Lead' });

    const { status, json } = await postWebhook('retell-call-analyzed', payload);

    assert.equal(status, 200);
    assert.equal(json.status, 'processed');
    assert.equal(json.phone, phone);
    assert.equal(json.reason, null);
  });

  it('Flow B: retell-call-analyzed works with committed fixture payload', async () => {
    const fixture = loadFixture('test-retell-webhook.json');
    fixture.call.call_id = `e2e-fixture-${Date.now()}`;

    const { status, json } = await postWebhook('retell-call-analyzed', fixture);

    assert.equal(status, 200);
    assert.equal(json.status, 'processed');
    assert.equal(json.phone, '+48111222333');
  });

  it('Flow B: non-call_analyzed events are skipped', async () => {
    const { status, json } = await postWebhook('retell-call-analyzed', {
      event: 'call_started',
      call: { call_id: 'e2e-skipped' },
    });

    assert.equal(status, 200);
    assert.equal(json.status, 'skipped');
    assert.equal(json.phone, null);
    assert.match(json.reason, /Ignored event: call_started/);
  });

  it('Flow B: inbound call_analyzed sets direction and source', async () => {
    const phone = uniqueE164('+48333');
    const payload = buildRetellInboundCallAnalyzedPayload({ phone, fullName: 'E2E Inbound Lead' });

    const { status, json } = await postWebhook('retell-call-analyzed', payload);

    assert.equal(status, 200);
    assert.equal(json.status, 'processed');
    assert.equal(json.phone, phone);
    assert.equal(json.direction, 'inbound');
  });

  it('Flow C: retell-check-availability returns slots', async () => {
    const payload = buildRetellCheckAvailabilityPayload();

    const { status, json } = await postWebhook('retell-check-availability', payload);

    assert.equal(status, 200);
    assert.ok(typeof json.available === 'boolean');
    assert.ok(Array.isArray(json.slots));
    if (json.available) {
      assert.ok(json.slots.length > 0);
      assert.ok(json.slots[0].label);
    }
  });

  it('Flow C: check availability works with committed fixture', async () => {
    const fixture = loadFixture('test-retell-check-availability.json');
    fixture.call.call_id = `e2e-avail-fixture-${Date.now()}`;

    const { status, json } = await postWebhook('retell-check-availability', fixture);

    assert.equal(status, 200);
    assert.ok(typeof json.available === 'boolean');
  });

  it('Flow D: retell-book-appointment rejects missing slot_start', async () => {
    const payload = buildRetellBookAppointmentPayload({ args: { slot_start: undefined, customer_name: 'Test' } });
    delete payload.args.slot_start;

    const { status, json } = await postWebhook('retell-book-appointment', payload);

    assert.equal(status, 200);
    assert.equal(json.success, false);
    assert.match(String(json.message), /slot_start/i);
  });

  it('Flow D: retell-book-appointment creates calendar event', {
    skip: calendarConfigured ? false : 'set E2E_CALENDAR=1 after Google Calendar OAuth is configured in n8n',
  }, async () => {
    const availPayload = buildRetellCheckAvailabilityPayload({ preferredDay: undefined, args: {} });
    const { json: avail } = await postWebhook('retell-check-availability', availPayload);
    assert.equal(avail.available, true, 'need at least one free slot to book');

    const slotStart = avail.slots[0].start;
    const payload = buildRetellBookAppointmentPayload({
      slotStart,
      fullName: 'E2E Calendar Booking',
      phone: uniqueE164('+48444'),
    });

    const { status, json } = await postWebhook('retell-book-appointment', payload);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.ok(json.booked_slot);
    assert.ok(json.label || json.message);
    assert.ok(json.eventId || json.message);
  });

  it('Flow D2: retell-list-appointments returns appointments array', async () => {
    const payload = buildRetellListAppointmentsPayload();

    const { status, json } = await postWebhook('retell-list-appointments', payload);

    assert.equal(status, 200);
    assert.ok(typeof json.found === 'boolean');
    assert.ok(Array.isArray(json.appointments));
  });

  it('Flow E: book then cancel appointment', {
    skip: calendarConfigured ? false : 'set E2E_CALENDAR=1 after Google Calendar OAuth is configured in n8n',
  }, async () => {
    const phone = uniqueE164('+48555');
    const availPayload = buildRetellCheckAvailabilityPayload({ phone, preferredDay: undefined, args: {} });
    const { json: avail } = await postWebhook('retell-check-availability', availPayload);
    assert.equal(avail.available, true, 'need at least one free slot to book');

    const slotStart = avail.slots[0].start;
    const bookPayload = buildRetellBookAppointmentPayload({
      slotStart,
      fullName: 'E2E Cancel Flow',
      phone,
    });
    const { json: booked } = await postWebhook('retell-book-appointment', bookPayload);
    assert.equal(booked.success, true);

    const cancelPayload = buildRetellCancelAppointmentPayload({
      slotStart: booked.booked_slot,
      fullName: 'E2E Cancel Flow',
      phone,
    });
    const { status, json } = await postWebhook('retell-cancel-appointment', cancelPayload);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.ok(json.label || json.message);
    assert.ok(json.cancelled_slot);
  });

  it('Flow F: book then reschedule appointment', {
    skip: calendarConfigured ? false : 'set E2E_CALENDAR=1 after Google Calendar OAuth is configured in n8n',
  }, async () => {
    const phone = uniqueE164('+48666');
    const availPayload = buildRetellCheckAvailabilityPayload({ phone, preferredDay: undefined, args: {} });
    const { json: avail } = await postWebhook('retell-check-availability', availPayload);
    assert.equal(avail.available, true);

    const oldSlot = avail.slots[0].start;
    const bookPayload = buildRetellBookAppointmentPayload({
      slotStart: oldSlot,
      fullName: 'E2E Reschedule Flow',
      phone,
    });
    const { json: booked } = await postWebhook('retell-book-appointment', bookPayload);
    assert.equal(booked.success, true);

    const avail2 = buildRetellCheckAvailabilityPayload({ phone, preferredDay: undefined, args: {} });
    const { json: availAgain } = await postWebhook('retell-check-availability', avail2);
    assert.equal(availAgain.available, true);
    const newSlot = availAgain.slots.find((s) => s.start !== oldSlot)?.start ?? availAgain.slots[0].start;

    const reschedulePayload = buildRetellRescheduleAppointmentPayload({
      oldSlotStart: booked.booked_slot,
      newSlotStart: newSlot,
      fullName: 'E2E Reschedule Flow',
      phone,
    });
    const { status, json } = await postWebhook('retell-reschedule-appointment', reschedulePayload);

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.ok(json.label || json.message);
    assert.ok(json.booked_slot);
  });

  it('Flow A: meta-lead-inbound accepts valid lead', {
    skip: dispatchRetell ? false : 'set E2E_DISPATCH_RETELL=1 to run (dispatches a real Retell call)',
  }, async () => {
    const phone = uniqueE164('+48222');
    const payload = buildMetaLeadPayload({ phone, fullName: 'E2E Meta Lead' });

    const { status, json } = await postWebhook('meta-lead-inbound', payload);

    assert.equal(status, 202);
    assert.equal(json.status, 'accepted');
    assert.equal(json.lead, 'E2E Meta Lead');
    assert.ok(json.httpStatus === 201 || json.httpStatus === 200, 'expected Retell HTTP 200/201');
    assert.ok(json.retellCallId, 'expected retellCallId from Retell API');
    assert.equal(json.retellError, null);
  });
});
