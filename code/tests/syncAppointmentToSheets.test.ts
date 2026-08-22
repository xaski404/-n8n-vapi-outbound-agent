import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAppointmentSheetRow,
  mergeSheetRow,
  sheetRowToValues,
  valuesToSheetRow,
} from '../syncAppointmentToSheets';

describe('syncAppointmentToSheets', () => {
  it('builds umówiono row with booked slot label', () => {
    const row = buildAppointmentSheetRow({
      phone: '+48123456789',
      fullName: 'Jakub Łaski',
      status: 'umówiono',
      bookedSlot: 'piątek, 21 sierpnia 10:00',
      callSummary: 'Umówiono trening',
    });
    assert.equal(row.status, 'umówiono');
    assert.equal(row.booked_slot, 'piątek, 21 sierpnia 10:00');
    assert.equal(row.preferred_session_date, 'piątek, 21 sierpnia 10:00');
    assert.equal(row.direction, 'inbound');
  });

  it('clears booked_slot on odwołanie', () => {
    const row = buildAppointmentSheetRow({
      phone: '+48123456789',
      fullName: 'Jakub Łaski',
      status: 'odwołanie',
      bookedSlot: 'piątek, 21 sierpnia 19:00',
    });
    assert.equal(row.status, 'odwołanie');
    assert.equal(row.booked_slot, '');
  });

  it('merges incoming appointment update with existing transcript', () => {
    const incoming = buildAppointmentSheetRow({
      phone: '+48123456789',
      fullName: 'Jakub Łaski',
      status: 'przełożono',
      bookedSlot: 'piątek, 28 sierpnia 10:00',
    });
    const merged = mergeSheetRow(
      { transcript: 'Agent: Dzień dobry.', recording_url: 'https://rec.example/a' },
      incoming,
    );
    assert.equal(merged.status, 'przełożono');
    assert.equal(merged.booked_slot, 'piątek, 28 sierpnia 10:00');
    assert.equal(merged.transcript, 'Agent: Dzień dobry.');
    assert.equal(merged.recording_url, 'https://rec.example/a');
  });

  it('round-trips row values', () => {
    const row = buildAppointmentSheetRow({
      phone: '+48111111111',
      fullName: 'Anna',
      status: 'umówiono',
      bookedSlot: 'czwartek, 20 sierpnia 14:00',
    });
    const values = sheetRowToValues(row);
    const parsed = valuesToSheetRow(values);
    assert.equal(parsed.phone, '48111111111');
    assert.equal(parsed.preferred_session_date, 'czwartek, 20 sierpnia 14:00');
  });
});
