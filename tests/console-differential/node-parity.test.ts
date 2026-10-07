import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { missionReference, prepareNodeMission, type Scenario } from './node-pipeline.js';
import scenarios from './scenarios.json';

// Portable half of the differential check: no import of LiteSVM/native.ts.
for (const scenario of scenarios as Scenario[]) {
  test('Node runner / standalone console canonical parity: ' + scenario.id, async () => {
    const core = await import(pathToFileURL(resolve('packages/console-core/dist/console-core.mjs')).href) as typeof import('../../packages/console-core/src/index.js');
    const scratch = mkdtempSync(join(tmpdir(), 'mule-node-parity-'));
    try {
      const node = await prepareNodeMission(scenario, scratch);
      const browser = await core.prepareMission(scenario.template, scenario.behavior, {
        missionReference: missionReference(scenario), designatedAgent: scenario.designatedAgent ? 'agent' : null,
      });
      for (const name of ['criteria', 'delivery', 'report'] as const) {
        assert.deepEqual(browser.artifacts[name].value, node[name].value);
        assert.deepEqual(Buffer.from(browser.artifacts[name].json), Buffer.from(node[name].json));
        assert.equal(browser.artifacts[name].hash, node[name].hash);
        assert.equal(createHash('sha256').update(node[name].json).digest('hex'), node[name].hash);
      }
      assert.equal(node.report.value.message, scenario.message);
      assert.equal(browser.artifacts.report.value.message, scenario.message);
      assert.equal(node.report.value.pass, scenario.behavior === 'honest');
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
}
