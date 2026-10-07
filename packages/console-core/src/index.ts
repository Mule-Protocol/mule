import { createValidator, ScriptedAgent, type Criteria, type JsonValue, type ValidationReport } from '@mule/mission-logic';
import { fixtureFor } from './generated/fixtures.js';
import { schemaValidator } from './generated/validators.js';
import { prepareArtifact, shortHash, type JsonArtifact } from './hash.js';
import { EscrowModel, type EscrowSnapshot, type EscrowTraceEntry, type Role } from './model.js';
export * from './model.js';
export * from './hash.js';
export type { Criteria, JsonValue, ValidationReport } from '@mule/mission-logic';

export type Template = 'invoice' | 'contract' | 'address';
export type Behavior = 'honest' | 'dishonest';
export interface MissionHashes { criteria: string; delivery: string; report: string }
export interface Step {
  station: 1 | 2 | 3 | 4 | 5;
  text: string;
  failed?: boolean;
  outcome?: 'settled' | 'returned';
  hashes?: MissionHashes;
  report?: ValidationReport;
}
export interface MissionOptions {
  missionReference?: string;
  designatedAgent?: Role | null;
  amount?: bigint;
  now?: bigint;
  deadline?: bigint;
  window?: bigint;
  clientBalance?: bigint;
  agentBalance?: bigint;
}
export interface MissionParameters {
  amount: bigint; now: bigint; deadline: bigint; window: bigint; designatedAgent: Role | null;
  clientBalance: bigint; agentBalance: bigint;
}
export interface PreparedMission {
  template: Template;
  behavior: Behavior;
  missionReference: string;
  parameters: MissionParameters;
  artifacts: {
    criteria: JsonArtifact<Criteria>;
    delivery: JsonArtifact<JsonValue>;
    report: JsonArtifact<ValidationReport>;
  };
  trace: readonly EscrowTraceEntry[];
  final: Readonly<EscrowSnapshot>;
}
const templates = {
  invoice: { model: 'invoice.v1', name: 'Invoice to JSON' },
  contract: { model: 'contract.v1', name: 'Contract summary' },
  address: { model: 'address.v1', name: 'Address normalization' },
} as const;
const validateDelivery = createValidator({ fixtureFor, schemaValidator });

/** Identical deterministic artifacts for the browser and the local differential tests. */
export async function prepareMission(template: Template, behavior: Behavior, options: MissionOptions = {}): Promise<PreparedMission> {
  if (!Object.hasOwn(templates, template) || !['honest', 'dishonest'].includes(behavior)) {
    throw new TypeError('Unknown mission configuration');
  }
  const missionReference = options.missionReference ?? `SIM-MISSION-${template}-${behavior}`;
  if (!/^SIM-MISSION-[A-Za-z0-9-]{1,80}$/.test(missionReference)) throw new TypeError('Expected a symbolic SIM-MISSION reference');
  const now = options.now ?? 1_700_000_000n;
  const parameters: MissionParameters = { amount: options.amount ?? 5_000_000n, now,
    deadline: options.deadline ?? now + 600n, window: options.window ?? 60n,
    designatedAgent: options.designatedAgent ?? null,
    clientBalance: options.clientBalance ?? 100_000_000n, agentBalance: options.agentBalance ?? 0n };
  const fixture = fixtureFor(templates[template].model);
  const criteria = await prepareArtifact(fixture.criteria);
  const deliveryValue = await new ScriptedAgent().produce({ model: fixture.criteria.model, mode: behavior, input: fixture.input });
  const delivery = await prepareArtifact(deliveryValue);
  const report = await prepareArtifact(validateDelivery({ mission: missionReference,
    criteria: criteria.value, delivery: delivery.value, criteriaHash: criteria.hash, deliveryHash: delivery.hash }));
  const model = new EscrowModel({ clientBalance: parameters.clientBalance, agentBalance: parameters.agentBalance });
  model.create('client', { amount: parameters.amount, deadline: parameters.deadline, window: parameters.window,
    designatedAgent: parameters.designatedAgent, criteriaHash: criteria.hash }, now);
  model.accept('agent', now);
  model.submit('agent', delivery.hash, now);
  model.recordVerdict('validator', report.value.pass, report.hash, now);
  model.finalize('outsider', now + parameters.window);
  return { template, behavior, missionReference, parameters, artifacts: { criteria, delivery, report }, trace: model.trace, final: model.snapshot() };
}

/** Presentation and timing remain the consumer's responsibility. No delays or I/O. */
export async function* runMission(template: Template, behavior: Behavior): AsyncIterable<Step> {
  const mission = await prepareMission(template, behavior);
  const { criteria, delivery, report } = mission.artifacts;
  const hashes = { criteria: criteria.hash, delivery: delivery.hash, report: report.hash };
  const paid = mission.final.status === 'settled';
  yield { station: 1, text: `ESCROW LOCKED · 5.00 dUSDC · SIM-TX-LOCK-${criteria.hash.slice(0, 8)}` };
  yield { station: 2, text: `MISSION ACCEPTED · AGENT MULE-01 · ${templates[template].name.toUpperCase()}` };
  yield { station: 3, text: `DELIVERY SUBMITTED · ${shortHash(delivery.hash)}` };
  yield { station: 4, text: `INSPECTION · ${report.value.message}`, failed: !report.value.pass, hashes, report: report.value };
  yield { station: 5, text: `${paid ? 'SETTLED · 5.00 dUSDC PAID TO AGENT' : 'RETURNED · 5.00 dUSDC REFUNDED TO CLIENT'} · SIM-TX-CLOSE-${report.hash.slice(0, 8)}`,
    failed: !paid, outcome: paid ? 'settled' : 'returned', hashes, report: report.value };
}
