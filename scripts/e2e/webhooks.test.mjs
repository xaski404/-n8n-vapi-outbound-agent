import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  N8N_BASE_URL,
  isN8nHealthy,
  postWebhook,
  loadFixture,
  buildRetellCallAnalyzedPayload,
  buildMetaLeadPayload,
  uniqueE164,
} from './helpers.mjs';

const n8nUp = await isN8nHealthy();
const dispatchRetell = process.env.E2E_DISPATCH_RETELL === '1';

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
