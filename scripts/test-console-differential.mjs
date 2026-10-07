import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

assert.equal(process.platform, 'linux', 'SBF differential tests run only in Linux CI; do not run LiteSVM on Windows');
assert.equal(process.versions.node.split('.')[0], '24', 'SBF differential tests require Node 24');
const scenarios = JSON.parse(readFileSync('tests/console-differential/scenarios.json', 'utf8'));
assert.equal(scenarios.length, 7);
assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, 7);
const sourcePaths = { sbf: 'target/deploy/mule_escrow.so', idl: 'target/idl/mule_escrow.json',
  bundle: 'packages/console-core/dist/console-core.mjs' };
const sourceSha256 = Object.fromEntries(Object.entries(sourcePaths).map(([name, path]) =>
  [name, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const directory = resolve('coverage/console-differential');
mkdirSync(directory, { recursive: true });
const summary = { schema: 1, engine: 'LiteSVM 0.8.0; compiled SBF; one Linux Node 24 process per scenario',
  sourcePaths, sourceSha256, expectedScenarios: 7, passed: 0, failed: 0, scenarios: [] };
for (const scenario of scenarios) {
  assert(/^[a-z-]+$/.test(scenario.id));
  const output = join(directory, scenario.id + '.json');
  rmSync(output, { force: true });
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'tests/console-differential/worker.ts', scenario.id, output],
    { stdio: 'inherit', timeout: 60_000 });
  try {
    assert.equal(run.error, undefined, 'Worker execution failed or timed out');
    assert.equal(run.status, 0, 'Worker failed; no automatic retry');
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(result.scenario, scenario);
    assert.deepEqual(result.sourceSha256, sourceSha256, 'All workers must test the same SBF, IDL and bundle');
    assert.equal(result.passed, true);
    assert.equal(result.trace.length, 5);
    assert.equal(result.reportHash.equal, true);
    assert.equal(result.final.equal, true);
    assert.equal(result.final.missionClosed, true);
    assert.equal(result.final.vaultClosed, true);
    if (scenario.designatedAgent) assert.equal(result.designatedAgent.outsiderRejectedByBoth, true);
    summary.passed++;
    summary.scenarios.push({ id: scenario.id, passed: true, evidence: scenario.id + '.json',
      statesCompared: 10, deltasCompared: 5, jsonArtifactsCompared: 3, hashesCompared: 3,
      outcome: result.final.sbf.status, reportHash: result.reportHash.onChain,
      validatorMessage: result.validatorMessage.node, designatedAgent: scenario.designatedAgent });
  } catch (error) {
    summary.failed++;
    summary.scenarios.push({ id: scenario.id, passed: false, evidence: scenario.id + '.json', error: String(error) });
    console.error(scenario.id + ': ' + String(error));
  }
}
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('Console/SBF differential scenarios: ' + summary.passed + '/7 passed');
if (summary.failed || summary.passed !== 7) process.exitCode = 1;
