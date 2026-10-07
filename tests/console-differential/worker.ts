import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bnToBigInt } from '../../packages/sdk/src/index.js';
import type { PreparedMission, EscrowTraceEntry } from '../../packages/console-core/src/index.js';
import { prepareNodeMission, missionReference, type Scenario } from './node-pipeline.js';
import definitions from './scenarios.json';

const sourcePaths = {
  sbf: 'target/deploy/mule_escrow.so', idl: 'target/idl/mule_escrow.json',
  bundle: 'packages/console-core/dist/console-core.mjs',
};
const output = process.argv[3];
assert(output, 'Output evidence path required');
const evidence: Record<string, unknown> = {
  schema: 1, passed: false, engine: 'LiteSVM 0.8.0; compiled SBF; isolated Linux Node 24 process',
  runtime: { node: process.version, platform: process.platform },
};
const trace: unknown[] = [];
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function run(): Promise<void> {
  assert.equal(process.platform, 'linux', 'Native differential execution is restricted to Linux CI');
  assert.equal(process.versions.node.split('.')[0], '24', 'Native differential execution requires Node 24');
  const scenario = (definitions as Scenario[]).find(entry => entry.id === process.argv[2]);
  assert(scenario, 'Unknown differential scenario');
  evidence.scenario = scenario;
  evidence.sourceSha256 = Object.fromEntries(Object.entries(sourcePaths)
    .map(([name, path]) => [name, digest(readFileSync(path))]));
  // Import the actual standalone artifact, not a second source-level substitute.
  const core = await import(pathToFileURL(resolve(sourcePaths.bundle)).href) as typeof import('../../packages/console-core/src/index.js');
  const { NativeMission } = await import('./native.js');
  const now = 1_700_000_000n, amount = 5_000_000n, window = 60n, deadline = now + 600n;
  const initialClient = 100_000_000n, initialAgent = 0n;
  const prepared: PreparedMission = await core.prepareMission(scenario.template, scenario.behavior, {
    missionReference: missionReference(scenario), designatedAgent: scenario.designatedAgent ? 'agent' : null,
    now, amount, window, deadline, clientBalance: initialClient, agentBalance: initialAgent,
  });
  assert.deepEqual(prepared.parameters, { now, amount, window, deadline, clientBalance: initialClient,
    agentBalance: initialAgent, designatedAgent: scenario.designatedAgent ? 'agent' : null });
  const scratch = mkdtempSync(join(tmpdir(), 'mule-console-parity-'));
  try {
    const node = await prepareNodeMission(scenario, scratch);
    for (const name of ['criteria', 'delivery', 'report'] as const) {
      assert.deepEqual(prepared.artifacts[name].value, node[name].value, name + ' exact JSON value');
      assert.deepEqual(Buffer.from(prepared.artifacts[name].json, 'utf8'), Buffer.from(node[name].json, 'utf8'),
        name + ' canonical UTF-8 bytes including final LF');
      assert.equal(prepared.artifacts[name].hash, node[name].hash, name + ' SHA-256');
      assert.equal(digest(prepared.artifacts[name].json), node[name].hash, name + ' independently recomputed digest');
    }
    assert.equal(node.report.value.message, scenario.message);
    assert.equal(prepared.artifacts.report.value.message, scenario.message);
    assert.equal(node.report.value.pass, scenario.behavior === 'honest');
    assert.equal(prepared.artifacts.report.value.pass, scenario.behavior === 'honest');
    evidence.artifacts = Object.fromEntries((['criteria', 'delivery', 'report'] as const).map(name =>
      [name, { hash: node[name].hash, json: node[name].json, value: node[name].value,
        nodeConsoleValuesEqual: true, nodeConsoleUtf8Equal: true, nodeConsoleHashEqual: true }]));
    evidence.reference = { value: missionReference(scenario),
      scope: 'Only the report reference is symbolic; validateMission normally passes its real mission PDA.' };
    evidence.validatorMessage = { node: node.report.value.message, console: prepared.artifacts.report.value.message, equal: true };

    const world = new NativeMission(now, initialClient, initialAgent);
    const replay = new core.EscrowModel({ clientBalance: initialClient, agentBalance: initialAgent });
    const expectedInstructions = ['create_mission', 'accept_mission', 'submit_delivery', 'record_verdict', 'finalize'];
    const expectedActors = ['client', 'agent', 'agent', 'validator', 'outsider'];
    const expectedStatuses = ['open', 'accepted', 'submitted',
      scenario.behavior === 'honest' ? 'passed' : 'failed',
      scenario.behavior === 'honest' ? 'settled' : 'refunded'];
    assert.deepEqual(prepared.trace.map(step => step.instruction), expectedInstructions);
    assert.deepEqual(prepared.trace.map(step => step.actor), expectedActors);
    assert.deepEqual(prepared.trace.map(step => step.now), [now, now, now, now, now + window]);
    assert.deepEqual(prepared.trace.map(step => step.after.status), expectedStatuses);
    evidence.trace = trace;
    let depositedRent = 0n;
    let clientBeforeClosure = 0n;
    const clientBeforeCreation = world.clientLamports();
    let recordedHash: string | null = null;
    for (const [index, step] of prepared.trace.entries()) {
      world.time(step.now);
      const before = world.snapshot();
      assert.deepEqual(before, step.before, step.instruction + ' before state and balances');
      assert.deepEqual(replay.snapshot(), before, 'Model replay before state');
      let args: Record<string, unknown> = {};
      let replayStep: EscrowTraceEntry;
      switch (step.instruction) {
        case 'create_mission':
          args = { mission_id: 1n, amount, deadline, dispute_window: window,
            designated_agent: scenario.designatedAgent ? world.actors.agent.publicKey : null,
            criteria_hash: Array.from(Buffer.from(node.criteria.hash, 'hex')), criteria_uri: node.criteria.uri };
          replayStep = replay.create('client', { amount, deadline, window, criteriaHash: node.criteria.hash,
            designatedAgent: scenario.designatedAgent ? 'agent' : null }, step.now);
          break;
        case 'accept_mission':
          if (scenario.designatedAgent) {
            const modelBefore = replay.snapshot();
            assert.throws(() => replay.accept('outsider', step.now),
              error => error instanceof core.EscrowModelError && error.code === 'NotDesignatedAgent');
            assert.deepEqual(replay.snapshot(), modelBefore);
            world.reject('accept_mission', 'outsider', {}, 'NotDesignatedAgent');
            evidence.designatedAgent = { outsiderRejectedByBoth: true, rejectionPreservesStateAndBalances: true,
              storedDesignatedAgent: 'agent', acceptedByDesignatedAgent: false };
          }
          replayStep = replay.accept('agent', step.now);
          break;
        case 'submit_delivery':
          args = { delivery_hash: Array.from(Buffer.from(node.delivery.hash, 'hex')), delivery_uri: node.delivery.uri };
          replayStep = replay.submit('agent', node.delivery.hash, step.now);
          break;
        case 'record_verdict':
          args = { pass: node.report.value.pass, report_hash: Array.from(Buffer.from(node.report.hash, 'hex')) };
          replayStep = replay.recordVerdict('validator', node.report.value.pass, node.report.hash, step.now);
          break;
        case 'finalize':
          clientBeforeClosure = world.clientLamports();
          replayStep = replay.finalize('outsider', step.now);
          break;
        default: throw new Error('Unexpected prepared instruction');
      }
      assert.deepEqual(replayStep, step, 'Public model replay equals bundled prepareMission trace');
      const event = world.call(step.instruction, step.actor, args);
      const after = world.snapshot();
      assert.equal(event.amount, amount);
      assert.equal(event.status, expectedStatuses[index]);
      const eventNames: string[] = ['MissionCreated', 'MissionAccepted', 'DeliverySubmitted', 'VerdictRecorded',
        scenario.behavior === 'honest' ? 'MissionSettled' : 'MissionRefunded'];
      assert.equal(event.name.replaceAll('_', '').toLowerCase(), eventNames[index]!.toLowerCase());
      assert.deepEqual(after, step.after, step.instruction + ' after state and balances');
      const delta = { client: after.balances.client - before.balances.client,
        agent: after.balances.agent - before.balances.agent, vault: after.balances.vault - before.balances.vault };
      assert.deepEqual(delta, step.delta, step.instruction + ' exact SPL deltas');
      assert.equal(after.balances.client + after.balances.agent + after.balances.vault, initialClient + initialAgent,
        'Conservation after every successful call');
      if (step.instruction !== 'finalize') {
        const chain = world.state();
        assert.equal(bnToBigInt(chain.amount), amount);
        assert.equal(bnToBigInt(chain.deadline), deadline);
        assert.equal(bnToBigInt(chain.disputeWindow), window);
        assert.deepEqual(chain.criteriaHash, Array.from(Buffer.from(node.criteria.hash, 'hex')));
        assert.equal(chain.criteriaUri, node.criteria.uri);
        assert.equal(chain.designatedAgent?.toBase58() ?? null,
          scenario.designatedAgent ? world.actors.agent.publicKey.toBase58() : null);
        if (index >= 1) assert(chain.agent?.equals(world.actors.agent.publicKey));
        if (index >= 2) {
          assert.deepEqual(chain.deliveryHash, Array.from(Buffer.from(node.delivery.hash, 'hex')));
          assert.equal(chain.deliveryUri, node.delivery.uri);
        }
        if (index === 1 && scenario.designatedAgent) {
          (evidence.designatedAgent as Record<string, unknown>).acceptedByDesignatedAgent = true;
        }
        if (index === 3) {
          assert(chain.verdictAt);
          assert.equal(bnToBigInt(chain.verdictAt), now);
          assert.equal(chain.originalVerdict, scenario.behavior === 'honest');
        }
      }
      if (step.instruction === 'create_mission') {
        depositedRent = world.rent();
        assert.equal(clientBeforeCreation - world.clientLamports(), depositedRent, 'Client funded exact escrow rent');
      }
      if (step.instruction === 'record_verdict') {
        recordedHash = after.reportHash;
        assert.equal(recordedHash, prepared.artifacts.report.hash, 'Console report hash recorded in real SBF mission');
        assert.equal(recordedHash, node.report.hash);
        assert.deepEqual(event.data.reportHash, Array.from(Buffer.from(recordedHash!, 'hex')));
        assert.equal(event.data.pass, node.report.value.pass);
      }
      trace.push({ instruction: step.instruction, actor: step.actor, now: step.now,
        console: { before: step.before, after: step.after, delta: step.delta },
        sbf: { before, after, delta, event: { name: event.name, status: event.status, amount: event.amount } },
        stateEqual: true, balancesEqual: true, deltaEqual: true, conservation: true });
    }
    const final = world.snapshot();
    assert.deepEqual(final, prepared.final);
    assert.deepEqual(final.balances, {
      client: initialClient - (scenario.behavior === 'honest' ? amount : 0n),
      agent: initialAgent + (scenario.behavior === 'honest' ? amount : 0n), vault: 0n,
    });
    const returnedRent = world.clientLamports() - clientBeforeClosure;
    assert.equal(returnedRent, depositedRent, 'Exact escrow rent returned to original client');
    assert.equal(world.clientLamports(), clientBeforeCreation, 'Client rent round trip; separate fee payer');
    assert(world.absent(world.mission) && world.absent(world.vault));
    evidence.reportHash = { node: node.report.hash, console: prepared.artifacts.report.hash, onChain: recordedHash, equal: true };
    evidence.final = { console: prepared.final, sbf: final, equal: true, missionClosed: true, vaultClosed: true,
      terminalSource: 'Successful SBF terminal event; pre-close on-chain agent/report hash retained for comparison.',
      clientRent: { deposited: depositedRent, returned: returnedRent, exact: true } };
    evidence.passed = true;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
run().catch(error => {
  evidence.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
}).finally(() => {
  writeFileSync(output, JSON.stringify(evidence, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(String((evidence.scenario as Scenario | undefined)?.id ?? process.argv[2]) + ': ' + (evidence.passed ? 'PASS' : 'FAIL'));
});
