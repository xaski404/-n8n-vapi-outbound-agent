import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapRetellToSheets } from '../mapRetellToSheets';

const fixturePath = join(process.cwd(), '..', 'scripts', 'test-retell-webhook.json');
const sampleWebhook = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('mapRetellToSheets', () => {
  it('maps call_analyzed webhook to a Google Sheets row', () => {
    const [result] = mapRetellToSheets([{ json: sampleWebhook }]);

    assert.equal(result.json.skipped, false);
    assert.equal(result.json.upsertKey, '48111222333');
    assert.equal(result.json.retellCallId, 'test-retell-local-001');
    assert.equal(result.json.disconnectionReason, 'user_hangup');

    const sheet = result.json.sheet as Record<string, string>;
    assert.equal(sheet.phone, '48111222333');
    assert.equal(sheet.full_name, 'Test Lead CRM');
    assert.equal(sheet.status, 'zainteresowany');
    assert.equal(sheet.direction, 'outbound');
    assert.equal(sheet.source, 'meta_lead_ad');
    assert.equal(sheet.call_summary, 'Test - zainteresowany darmowym treningiem personalnym');
    assert.equal(sheet.sessions_per_week, '2');
    assert.equal(sheet.preferred_session_date, 'czwartek o 8');
    assert.match(sheet.transcript, /interesuje mnie trening/);
  });

  it('reads payload from item.json.body (n8n webhook wrapper)', () => {
    const [result] = mapRetellToSheets([{ json: { body: sampleWebhook } }]);

    assert.equal(result.json.skipped, false);
    assert.equal((result.json.sheet as { phone: string }).phone, '48111222333');
  });

  it('skips non-call_analyzed events', () => {
    const [result] = mapRetellToSheets([
      { json: { event: 'call_started', call: { call_id: 'x' } } },
    ]);

    assert.equal(result.json.skipped, true);
    assert.match(String(result.json.reason), /Ignored event: call_started/);
  });

  it('uses from_number for inbound calls', () => {
    const [result] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'inbound',
            from_number: '+48100999888',
            to_number: '+48324412887',
            call_analysis: { custom_analysis_data: {} },
          },
        },
      },
    ]);

    assert.equal((result.json.sheet as { phone: string }).phone, '48100999888');
    assert.equal((result.json.sheet as { direction: string }).direction, 'inbound');
    assert.equal((result.json.sheet as { source: string }).source, 'inbound_call');
  });

  it('normalizes Polish spoken hours in preferred_session_date', () => {
    const cases: Array<[string, string]> = [
      ['czwartek o ósmej', 'czwartek o 8'],
      ['piątek o dziewiątej', 'piątek o 9'],
      ['wpół do szesnastej', 'o 15:30'],
      ['piętnasta trzydzieści', 'o 15:30'],
    ];

    for (const [input, expected] of cases) {
      const [result] = mapRetellToSheets([
        {
          json: {
            event: 'call_analyzed',
            call: {
              direction: 'outbound',
              to_number: '+48111222333',
              call_analysis: {
                custom_analysis_data: { preferred_session_date: input },
              },
            },
          },
        },
      ]);

      assert.equal(
        (result.json.sheet as { preferred_session_date: string }).preferred_session_date,
        expected,
        `expected "${input}" -> "${expected}"`,
      );
    }
  });

  it('maps outcome values to Polish CRM statuses', () => {
    const cases: Array<[string, string]> = [
      ['zainteresowany', 'zainteresowany'],
      ['interested', 'zainteresowany'],
      ['niezainteresowany', 'niezainteresowany'],
      ['not_interested', 'niezainteresowany'],
      ['no_answer', 'brak odpowiedzi'],
      ['voicemail', 'brak odpowiedzi'],
      ['callback', 'brak odpowiedzi'],
      ['odwołanie', 'odwołanie'],
      ['przełożono', 'przełożono'],
      ['umówiono', 'umówiono'],
    ];

    for (const [outcome, expectedStatus] of cases) {
      const [result] = mapRetellToSheets([
        {
          json: {
            event: 'call_analyzed',
            call: {
              direction: 'outbound',
              to_number: '+48111222333',
              call_analysis: {
                custom_analysis_data: { outcome },
              },
            },
          },
        },
      ]);

      assert.equal(
        (result.json.sheet as { status: string }).status,
        expectedStatus,
        `outcome "${outcome}" -> "${expectedStatus}"`,
      );
    }
  });

  it('marks successful calls with a preferred date as interested when outcome is missing', () => {
    const [result] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'outbound',
            to_number: '+48111222333',
            call_analysis: {
              call_successful: true,
              custom_analysis_data: { preferred_session_date: 'poniedziałek o 10' },
            },
          },
        },
      },
    ]);

    assert.equal((result.json.sheet as { status: string }).status, 'zainteresowany');
    assert.equal(
      (result.json.sheet as { preferred_session_date: string }).preferred_session_date,
      'poniedziałek o 10',
    );
  });

  it('marks meta outbound source from campaign_name in dynamic vars', () => {
    const [result] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'outbound',
            to_number: '+48111222333',
            retell_llm_dynamic_variables: {
              full_name: 'Anna Kowalska',
              campaign_name: 'meta-darmowy-trening',
            },
            call_analysis: {
              call_summary: 'Lead z Meta, umówiony termin',
              custom_analysis_data: { outcome: 'zainteresowany', booked_slot: '2026-08-20T10:00:00Z' },
            },
            transcript: 'Agent: Cześć...',
          },
        },
      },
    ]);

    const sheet = result.json.sheet as { source: string; status: string };
    assert.equal(sheet.source, 'meta_lead_ad');
    assert.equal(sheet.status, 'zainteresowany');
  });

  it('maps niezainteresowany and nieodebrane outcomes', () => {
    const [notInterested] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'outbound',
            to_number: '+48111222333',
            call_analysis: { custom_analysis_data: { outcome: 'niezainteresowany' } },
          },
        },
      },
    ]);
    assert.equal((notInterested.json.sheet as { status: string }).status, 'niezainteresowany');

    const [noAnswer] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'outbound',
            to_number: '+48111222333',
            disconnection_reason: 'voicemail_reached',
            call_analysis: { in_voicemail: true, custom_analysis_data: {} },
          },
        },
      },
    ]);
    assert.equal((noAnswer.json.sheet as { status: string }).status, 'brak odpowiedzi');
  });

  it('clears booked_slot when outcome is odwołanie', () => {
    const [result] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'inbound',
            from_number: '+48111222333',
            call_analysis: {
              custom_analysis_data: { outcome: 'odwołanie', booked_slot: '2026-08-20T10:00:00Z' },
            },
          },
        },
      },
    ]);
    const sheet = result.json.sheet as {
      status: string;
      booked_slot: string;
      preferred_session_date: string;
    };
    assert.equal(sheet.status, 'odwołanie');
    assert.equal(sheet.booked_slot, '');
    assert.equal(sheet.preferred_session_date, '');
  });

  it('infers umówiono and term from English call summary when custom_analysis_data is empty', () => {
    const [result] = mapRetellToSheets([
      {
        json: {
          event: 'call_analyzed',
          call: {
            direction: 'inbound',
            from_number: '+48799839938',
            call_analysis: {
              call_successful: true,
              call_summary:
                'The user Jakub Łaski booked a training session for Friday, August 21st at 11:00 AM.',
              custom_analysis_data: {},
            },
            transcript: 'Agent: Dzień dobry.',
          },
        },
      },
    ]);

    const sheet = result.json.sheet as {
      phone: string;
      full_name: string;
      status: string;
      preferred_session_date: string;
    };
    assert.equal(sheet.phone, '48799839938');
    assert.equal(sheet.full_name, 'Jakub Łaski');
    assert.equal(sheet.status, 'umówiono');
    assert.match(sheet.preferred_session_date, /piątek, 21 sierpnia 11:00/);
  });
});
