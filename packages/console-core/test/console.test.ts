import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { prepareMission, runMission, sha256, shortHash, type Template, type Behavior } from '../src/index.js';

const messages = {
  invoice: { honest: '6/6 FIELDS VALID', dishonest: '5/6 · MISSING: total_amount' },
  contract: { honest: '5/5 FIELDS VALID', dishonest: '4/5 · MISSING: governing_law' },
  address: { honest: '12/12 ROWS VALID', dishonest: '11/12 · INVALID POSTCODE, ROW 7' },
};
for (const template of ['invoice', 'contract', 'address'] as const) {
  for (const behavior of ['honest', 'dishonest'] as const) {
    test(`${template}/${behavior}: real validator, canonical artifacts and compatible five-step interface`, async () => {
      const mission = await prepareMission(template, behavior);
      assert.equal(mission.artifacts.report.value.message, messages[template][behavior]);
      assert.equal(mission.artifacts.report.value.pass, behavior === 'honest');
      assert.equal(mission.missionReference, `SIM-MISSION-${template}-${behavior}`);
      for (const artifact of Object.values(mission.artifacts)) {
        assert(artifact.json.endsWith('\n') && !artifact.json.endsWith('\n\n'));
        assert.equal(createHash('sha256').update(artifact.json, 'utf8').digest('hex'), artifact.hash);
        assert.deepEqual(JSON.parse(artifact.json), artifact.value);
      }
      assert.equal(mission.artifacts.report.value.criteria_hash, mission.artifacts.criteria.hash);
      assert.equal(mission.artifacts.report.value.delivery_hash, mission.artifacts.delivery.hash);
      const status = behavior === 'honest' ? 'settled' : 'refunded';
      assert.equal(mission.final.status, status);
      assert.deepEqual(mission.final.balances, { client: behavior === 'honest' ? 95_000_000n : 100_000_000n,
        agent: behavior === 'honest' ? 5_000_000n : 0n, vault: 0n });
      assert.deepEqual(mission.trace.map(step => step.after.status), ['open', 'accepted', 'submitted', behavior === 'honest' ? 'passed' : 'failed', status]);
      for (const step of mission.trace) assert.equal(step.delta.client + step.delta.agent + step.delta.vault, 0n);
      const steps = [];
      for await (const step of runMission(template, behavior)) steps.push(step);
      assert.deepEqual(steps.map(step => step.station), [1, 2, 3, 4, 5]);
      assert.match(steps[0]!.text, /^ESCROW LOCKED · 5\.00 dUSDC · SIM-TX-LOCK-[a-f0-9]{8}$/);
      assert.match(steps[2]!.text, /^DELIVERY SUBMITTED · sha256:[a-f0-9]{4}…[a-f0-9]{4}$/);
      assert.equal(steps[3]!.text, 'INSPECTION · ' + messages[template][behavior]);
      assert.equal(steps[3]!.failed, behavior === 'dishonest');
      assert.equal(steps[4]!.outcome, behavior === 'honest' ? 'settled' : 'returned');
      assert(steps[4]!.text.includes('SIM-TX-CLOSE-'));
      assert.equal(steps[4]!.report?.message, messages[template][behavior]);
      assert.deepEqual(steps[4]!.hashes, { criteria: mission.artifacts.criteria.hash,
        delivery: mission.artifacts.delivery.hash, report: mission.artifacts.report.hash });
      assert(!steps.some(step => /FAKE_|https?:\/\/|[1-9A-HJ-NP-Za-km-z]{40,}/.test(step.text)));
    });
  }
}

test('artifact generation is deterministic and designated mission uses the same shared agent', async () => {
  const a = await prepareMission('invoice', 'honest', { missionReference: 'SIM-MISSION-designated', designatedAgent: 'agent' });
  const b = await prepareMission('invoice', 'honest', { missionReference: 'SIM-MISSION-designated', designatedAgent: 'agent' });
  assert.deepEqual(a, b);
  assert.equal(a.trace[1]!.after.agent, 'agent');
  assert.equal(a.parameters.designatedAgent, 'agent');
});

test('configuration and references fail closed, WebCrypto hashes exact input bytes', async () => {
  await assert.rejects(prepareMission('unknown' as Template, 'honest'), /Unknown mission/);
  await assert.rejects(prepareMission('invoice', 'unknown' as Behavior), /Unknown mission/);
  await assert.rejects(prepareMission('invoice', 'honest', { missionReference: 'unmarked-reference' }), /symbolic/);
  assert.equal(await sha256('abc'), createHash('sha256').update('abc').digest('hex'));
  assert.notEqual(await sha256('abc'), await sha256('abc\n'));
  assert.equal(shortHash('a'.repeat(64)), 'sha256:aaaa…aaaa');
  assert.throws(() => shortHash('not-a-hash'), /SHA-256/);
});
