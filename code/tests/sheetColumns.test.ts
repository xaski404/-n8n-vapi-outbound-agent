import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findLastSheetRowByPhone,
  mergeSheetRowsForUpsert,
  valuesToPartialSheetRow,
} from '../sheetColumns';
import type { VoiceLeadSheetRow } from '../types';

describe('sheetColumns', () => {
  it('findLastSheetRowByPhone returns the most recent row for a phone', () => {
    const rows = [
      ['phone', 'name'],
      ['48111222333', 'Stary'],
      ['48999888777', 'Inny'],
      ['48111222333', 'Nowy'],
    ];
    const { rowNumber, values } = findLastSheetRowByPhone(rows, '+48 111 222 333');
    assert.equal(rowNumber, 4);
    assert.equal(values?.[1], 'Nowy');
  });

  it('mergeSheetRowsForUpsert keeps booking term and adds transcript after call', () => {
    const existing = valuesToPartialSheetRow([
      '48111222333',
      'Jan Kowalski',
      'umówiono',
      'Krótkie podsumowanie z book',
      '',
      '',
      '2',
      'piątek, 5 września, 18:00',
    ]);
    const incoming: VoiceLeadSheetRow = {
      phone: '48111222333',
      full_name: 'Nieznany kontakt',
      status: 'zainteresowany',
      call_summary: 'Pełne podsumowanie po rozmowie',
      recording_url: 'https://example.com/rec.mp3',
      transcript: 'Agent: Dzień dobry.\nUser: Chcę umówić trening.',
      sessions_per_week: '',
      preferred_session_date: '',
      booked_slot: '',
    };

    const merged = mergeSheetRowsForUpsert(existing, incoming);
    assert.equal(merged.status, 'umówiono');
    assert.equal(merged.full_name, 'Jan Kowalski');
    assert.equal(merged.preferred_session_date, 'piątek, 5 września, 18:00');
    assert.match(merged.transcript, /Chcę umówić trening/);
    assert.equal(merged.recording_url, 'https://example.com/rec.mp3');
    assert.equal(merged.call_summary, 'Pełne podsumowanie po rozmowie');
  });
});
