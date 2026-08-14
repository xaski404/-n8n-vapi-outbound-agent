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
  it('generates a valid n8n workflow JSON with both flows', () => {
    const hadBackup = existsSync(workflowPath);
    if (hadBackup) {
      readFileSync(workflowPath); // ensure readable before backup
      rmSync(backupPath, { force: true });
      copyFileSync(workflowPath, backupPath);
    }

    try {
      runBuild();
      const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));

      assert.ok(wf.name.includes('Retell'));
      assert.equal(wf.settings.executionOrder, 'v1');

      const nodeNames = wf.nodes.map((n) => n.name);
      assert.deepEqual(
        [
          'Webhook — Meta Lead',
          'Parse Meta Lead',
          'Build Retell Payload',
          'Dispatch Retell Call',
          'Ack Meta',
          'Webhook — Retell Call Analyzed',
          'Map Retell to Sheets',
          'Call analyzed?',
          'Get Sheet Tab Name',
          'Append Google Sheets Row',
          'Ack Retell',
        ].every((name) => nodeNames.includes(name)),
        true,
      );

      const mapNode = wf.nodes.find((n) => n.name === 'Map Retell to Sheets');
      assert.ok(mapNode.parameters.jsCode.includes('normalizePreferredSessionDate'));
      assert.ok(mapNode.parameters.jsCode.includes("event !== 'call_analyzed'"));

      const parseNode = wf.nodes.find((n) => n.name === 'Parse Meta Lead');
      assert.ok(parseNode.parameters.jsCode.includes('toE164'));
      assert.ok(parseNode.parameters.jsCode.includes('DEFAULT_CAMPAIGN'));

      assert.ok(wf.connections['Webhook — Meta Lead']);
      assert.ok(wf.connections['Webhook — Retell Call Analyzed']);
      assert.ok(wf.connections['Call analyzed?'].main.length === 2);
    } finally {
      if (hadBackup && existsSync(backupPath)) {
        copyFileSync(backupPath, workflowPath);
        rmSync(backupPath, { force: true });
      }
    }
  });
});
