/** Independent, deliberately scoped escrow model for the console scenarios.
 * Symbolic actors and token units only; no program, accounts, rent or signatures. */
export type Role = 'client' | 'agent' | 'validator' | 'outsider';
export type EscrowStatus = 'absent' | 'open' | 'accepted' | 'submitted' | 'passed' | 'failed' | 'settled' | 'refunded';
export type ModelInstruction = 'create_mission' | 'accept_mission' | 'submit_delivery' | 'record_verdict'
  | 'finalize' | 'refund_expired' | 'refund_stale';
export interface Balances { client: bigint; agent: bigint; vault: bigint }
export interface EscrowSnapshot {
  status: EscrowStatus;
  balances: Readonly<Balances>;
  agent: Role | null;
  reportHash: string | null;
}
export interface EscrowTraceEntry {
  instruction: ModelInstruction;
  actor: Role;
  now: bigint;
  before: Readonly<EscrowSnapshot>;
  after: Readonly<EscrowSnapshot>;
  delta: Readonly<Balances>;
}
export interface ModelConfig { minWindow: bigint; maxAmount: bigint; paused: boolean }
export interface ModelTerms {
  amount: bigint;
  deadline: bigint;
  window: bigint;
  criteriaHash: string;
  designatedAgent: Role | null;
}
export class EscrowModelError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'EscrowModelError'; }
}
export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_I64 = (1n << 63n) - 1n;
export const STALE_SECONDS = 604_800n;
const MIN_I64 = -(1n << 63n);
function requireCondition(condition: boolean, code: string): asserts condition {
  if (!condition) throw new EscrowModelError(code);
}
function u64(value: bigint): void {
  requireCondition(typeof value === 'bigint' && value >= 0n && value <= MAX_U64, 'U64OutOfRange');
}
function i64(value: bigint): void {
  requireCondition(typeof value === 'bigint' && value >= MIN_I64 && value <= MAX_I64, 'I64OutOfRange');
}
function role(value: Role): void {
  requireCondition(['client', 'agent', 'validator', 'outsider'].includes(value), 'UnknownRole');
}
function digest(value: string): void {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'InvalidHash');
}
function frozen(snapshot: EscrowSnapshot): Readonly<EscrowSnapshot> {
  return Object.freeze({ ...snapshot, balances: Object.freeze({ ...snapshot.balances }) });
}

export class EscrowModel {
  readonly config: Readonly<ModelConfig>;
  #state: Readonly<EscrowSnapshot>;
  #terms: ModelTerms | null = null;
  #verdictAt: bigint | null = null;
  #trace: EscrowTraceEntry[] = [];
  constructor(options: { clientBalance?: bigint; agentBalance?: bigint; config?: Partial<ModelConfig> } = {}) {
    const client = options.clientBalance ?? 100_000_000n, agent = options.agentBalance ?? 0n;
    u64(client); u64(agent);
    const config = { minWindow: 60n, maxAmount: 100_000_000n, paused: false, ...options.config };
    i64(config.minWindow); u64(config.maxAmount);
    requireCondition(config.minWindow > 0n && config.maxAmount > 0n && typeof config.paused === 'boolean', 'InvalidConfig');
    this.config = Object.freeze(config);
    this.#state = frozen({ status: 'absent', balances: { client, agent, vault: 0n }, agent: null, reportHash: null });
  }
  snapshot(): Readonly<EscrowSnapshot> { return this.#state; }
  get trace(): readonly EscrowTraceEntry[] { return this.#trace.slice(); }
  private state(...allowed: EscrowStatus[]): void {
    requireCondition(allowed.includes(this.#state.status), 'InvalidState');
  }
  private context(actor: Role, now: bigint): void { role(actor); i64(now); }
  private terms(): ModelTerms {
    requireCondition(this.#terms !== null, 'MissionAbsent'); return this.#terms;
  }
  private commit(instruction: ModelInstruction, actor: Role, now: bigint, changes: Partial<EscrowSnapshot>): EscrowTraceEntry {
    const before = this.#state;
    const after = frozen({ ...before, ...changes });
    const delta = Object.freeze({ client: after.balances.client - before.balances.client,
      agent: after.balances.agent - before.balances.agent, vault: after.balances.vault - before.balances.vault });
    const entry = Object.freeze({ instruction, actor, now, before, after, delta });
    this.#state = after; this.#trace.push(entry); return entry;
  }
  create(actor: Role, terms: ModelTerms, now: bigint): EscrowTraceEntry {
    this.context(actor, now); this.state('absent');
    requireCondition(actor === 'client', actor === 'validator' ? 'ValidatorCannotBeClient' : 'WrongClient');
    requireCondition(!this.config.paused, 'Paused');
    u64(terms.amount); i64(terms.deadline); i64(terms.window); digest(terms.criteriaHash);
    if (terms.designatedAgent !== null) role(terms.designatedAgent);
    requireCondition(terms.designatedAgent !== 'client', 'ClientCannotDesignateSelf');
    requireCondition(terms.designatedAgent !== 'validator', 'ValidatorCannotBeDesignatedAgent');
    requireCondition(terms.amount > 0n && terms.amount <= this.config.maxAmount, 'InvalidAmount');
    requireCondition(terms.amount <= this.#state.balances.client, 'InsufficientFunds');
    requireCondition(terms.deadline > now, 'InvalidDeadline');
    requireCondition(terms.window >= this.config.minWindow, 'InvalidWindow');
    requireCondition(terms.deadline + STALE_SECONDS <= MAX_I64 && terms.deadline + terms.window <= MAX_I64, 'ArithmeticOverflow');
    this.#terms = { ...terms };
    return this.commit('create_mission', actor, now, { status: 'open', balances: {
      client: this.#state.balances.client - terms.amount, agent: this.#state.balances.agent, vault: terms.amount } });
  }
  accept(actor: Role, now: bigint): EscrowTraceEntry {
    this.context(actor, now); this.state('open'); const terms = this.terms();
    requireCondition(actor !== 'client', 'ClientCannotAccept');
    requireCondition(actor !== 'validator', 'ValidatorCannotAccept');
    requireCondition(terms.designatedAgent === null || actor === terms.designatedAgent, 'NotDesignatedAgent');
    requireCondition(now < terms.deadline, 'DeadlinePassed');
    return this.commit('accept_mission', actor, now, { status: 'accepted', agent: actor });
  }
  submit(actor: Role, deliveryHash: string, now: bigint): EscrowTraceEntry {
    this.context(actor, now); this.state('accepted'); digest(deliveryHash);
    requireCondition(actor === this.#state.agent, 'UnauthorizedAgent');
    requireCondition(now < this.terms().deadline, 'DeadlinePassed');
    return this.commit('submit_delivery', actor, now, { status: 'submitted' });
  }
  recordVerdict(actor: Role, passed: boolean, reportHash: string, now: bigint): EscrowTraceEntry {
    this.context(actor, now); this.state('submitted'); digest(reportHash);
    requireCondition(actor === 'validator', 'UnauthorizedValidator');
    requireCondition(typeof passed === 'boolean', 'InvalidVerdict');
    requireCondition(now + this.terms().window <= MAX_I64, 'ArithmeticOverflow');
    this.#verdictAt = now;
    return this.commit('record_verdict', actor, now, { status: passed ? 'passed' : 'failed', reportHash });
  }
  private close(instruction: 'finalize' | 'refund_expired' | 'refund_stale', actor: Role, now: bigint, payAgent: boolean): EscrowTraceEntry {
    const balances = this.#state.balances;
    const recipient = payAgent ? balances.agent : balances.client;
    requireCondition(recipient + balances.vault <= MAX_U64, 'ArithmeticOverflow');
    return this.commit(instruction, actor, now, { status: payAgent ? 'settled' : 'refunded', balances: {
      client: balances.client + (payAgent ? 0n : balances.vault),
      agent: balances.agent + (payAgent ? balances.vault : 0n), vault: 0n } });
  }
  finalize(actor: Role, now: bigint): EscrowTraceEntry {
    this.context(actor, now); this.state('passed', 'failed');
    requireCondition(this.#verdictAt !== null && now >= this.#verdictAt + this.terms().window, 'DisputeWindowActive');
    return this.close('finalize', actor, now, this.#state.status === 'passed');
  }
  refund(actor: Role, reason: 'expired' | 'stale', now: bigint): EscrowTraceEntry {
    this.context(actor, now);
    requireCondition(reason === 'expired' || reason === 'stale', 'UnknownRefund');
    if (reason === 'expired') {
      this.state('open', 'accepted');
      requireCondition(now >= this.terms().deadline, 'DeadlineNotReached');
    } else {
      this.state('submitted');
      requireCondition(now >= this.terms().deadline + STALE_SECONDS, 'StaleTimeoutNotReached');
    }
    return this.close(reason === 'expired' ? 'refund_expired' : 'refund_stale', actor, now, false);
  }
}
