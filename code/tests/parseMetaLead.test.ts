import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseMetaLead } from '../parseMetaLead';

const fixturePath = join(process.cwd(), '..', 'scripts', '_test-lead.json');
const sampleLead = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('parseMetaLead', () => {
  it('normalizes a valid Meta lead payload', () => {
    const [result] = parseMetaLead([{ json: sampleLead }]);

    assert.equal(result.json.fullName, 'Test Live');
    assert.equal(result.json.firstName, 'Test');
    assert.equal(result.json.lastName, 'Live');
    assert.equal(result.json.phoneE164, '+48799839938');
    assert.equal(result.json.campaignName, 'test-live');
    assert.equal(result.json.leadgenId, null);
    assert.ok(result.json.sourcedAt);
    assert.deepEqual(result.json._meta, sampleLead);
  });

  it('reads payload from item.json.body (n8n webhook wrapper)', () => {
    const [result] = parseMetaLead([{ json: { body: sampleLead } }]);

    assert.equal(result.json.fullName, 'Test Live');
    assert.equal(result.json.phoneE164, '+48799839938');
  });

  it('coerces US-style phone numbers to E.164 with default country code', () => {
    const [result] = parseMetaLead([
      {
        json: {
          full_name: 'Jane Q Doe',
          phone_number: '(415) 555-2671',
          campaign_name: 'Summer Promo',
        },
      },
    ]);

    assert.equal(result.json.phoneE164, '+14155552671');
    assert.equal(result.json.firstName, 'Jane');
    assert.equal(result.json.lastName, 'Q Doe');
  });

  it('handles international numbers prefixed with 00', () => {
    const [result] = parseMetaLead([
      {
        json: {
          full_name: 'EU Lead',
          phone_number: '0048799839938',
          campaign_name: 'EU',
        },
      },
    ]);

    assert.equal(result.json.phoneE164, '+48799839938');
  });

  it('throws when required fields are missing', () => {
    assert.throws(
      () => parseMetaLead([{ json: { full_name: 'No Phone' } }]),
      /Missing required Meta fields: phone_number, campaign_name/,
    );
  });

  it('throws on empty phone_number', () => {
    assert.throws(
      () =>
        parseMetaLead([
          {
            json: {
              full_name: 'Empty Phone',
              phone_number: '   ',
              campaign_name: 'Test',
            },
          },
        ]),
      /Missing required Meta fields: phone_number/,
    );
  });

  it('throws on invalid E.164 phone', () => {
    assert.throws(
      () =>
        parseMetaLead([
          {
            json: {
              full_name: 'Bad Phone',
              phone_number: '+12',
              campaign_name: 'Test',
            },
          },
        ]),
      /Invalid E\.164 phone/,
    );
  });
});
