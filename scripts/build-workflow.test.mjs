import { readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const workflowPath = join(root, 'workflows', 'vapi-outbound-agent.json');
const backupPath = `${workflowPath}.test-backup`;

function runBuild() {
  const result = spawnSync(process.execPath, [join(__dirname, 'build-workflow.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

describe('build-workflow.mjs', () => {
  it('generates a valid n8n workflow JSON with all flows', () => {
    const hadBackup = existsSync(workflowPath);
    if (hadBackup) {
      readFileSync(workflowPath);
      rmSync(backupPath, { force: true });
      copyFileSync(workflowPath, backupPath);
    }

    try {
      runBuild();
      const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));

      assert.ok(wf.name.includes('Obsługa klienta'));
      assert.equal(wf.settings.executionOrder, 'v1');

      const nodeNames = wf.nodes.map((n) => n.name);
      const required = [
        'Webhook — Meta Lead',
        'Parse Meta Lead',
        'Build Retell Payload',
        'Dispatch Retell Call',
        'Ack Meta',
        'Webhook — Retell Call Analyzed',
        'Map Retell to Sheets',
        'Call analyzed?',
        'Get Sheet Tab Name',
        'Get Phone Column',
        'Prepare Sheets Upsert',
        'Row exists?',
        'Update Sheets Row',
        'Append Sheets Row',
        'Build Webhook Ack',
        'Ack Retell',
        'Webhook — Check Availability',
        'Prepare Availability',
        'Calendar FreeBusy (Check)',
        'Merge Availability',
        'Ack Availability',
        'Webhook — Book Appointment',
        'Prepare Booking',
        'Booking params OK?',
        'Calendar FreeBusy (Book)',
        'Validate Booking',
        'Booking valid?',
        'Create Calendar Event',
        'Ack Booking OK',
        'Ack Booking Fail',
        'Webhook — Cancel Appointment',
        'Prepare Cancel',
        'Cancel params OK?',
        'List Events (Cancel)',
        'Resolve Cancel',
        'Cancel event found?',
        'Delete Calendar Event',
        'Ack Cancel OK',
        'Ack Cancel Fail',
        'Webhook — Reschedule Appointment',
        'Prepare Reschedule',
        'Reschedule params OK?',
        'List Events (Reschedule)',
        'Resolve Reschedule',
        'Reschedule event found?',
        'Calendar FreeBusy (Reschedule)',
        'Validate Reschedule',
        'Reschedule valid?',
        'Patch Calendar Event',
        'Ack Reschedule OK',
        'Ack Reschedule Fail',
      ];
      assert.deepEqual(required.every((name) => nodeNames.includes(name)), true);

      const mapNode = wf.nodes.find((n) => n.name === 'Map Retell to Sheets');
      assert.ok(mapNode.parameters.jsCode.includes('resolveDirection'));
      assert.ok(mapNode.parameters.jsCode.includes("event !== 'call_analyzed'"));

      const availNode = wf.nodes.find((n) => n.name === 'Prepare Availability');
      assert.ok(availNode.parameters.jsCode.includes('getAvailableSlots'));

      assert.ok(wf.connections['Webhook — Check Availability']);
      assert.ok(wf.connections['Webhook — Book Appointment']);
      assert.ok(wf.connections['Webhook — Cancel Appointment']);
      assert.ok(wf.connections['Webhook — Reschedule Appointment']);
      assert.ok(wf.connections['Row exists?'].main.length === 2);
    } finally {
      if (hadBackup && existsSync(backupPath)) {
        copyFileSync(backupPath, workflowPath);
        rmSync(backupPath, { force: true });
      }
    }
  });
});
