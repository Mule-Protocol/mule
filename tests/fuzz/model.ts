/** Independent executable specification of docs/state-machine.md.
 * Pure values: no SDK/SBF decoding, PDA helper or instruction implementation. */
export const DAY = 86_400n;
export const STALE = 7n * DAY;
export const DISPUTE = 14n * DAY;
export const I64_MAX = (1n << 63n) - 1n;
export type Operation = 'initialize_config' | 'update_config' | 'propose_admin' | 'accept_admin'
  | 'cancel_admin_proposal' | 'create_mission' | 'cancel_mission' | 'accept_mission'
  | 'submit_delivery' | 'record_verdict' | 'open_dispute' | 'resolve_dispute'
  | 'finalize' | 'refund_expired' | 'refund_stale';
export type State = 'absent' | 'open' | 'accepted' | 'submitted' | 'passed' | 'failed'
  | 'disputed' | 'settled' | 'refunded' | 'cancelled';
export interface Command {
  op: Operation | 'progress' | 'clock';
  actor: number; target: number; other: number; amount: number;
  boundary: 'delta' | 'deadline' | 'window' | 'dispute' | 'stale';
  offset: number; window: number; flag: boolean; redirect: number;
}
export interface ConfigModel { admin: number; validator: number; pending: number | null; minWindow: bigint; cap: bigint; paused: boolean }
export interface MissionModel {
  id: bigint; client: number; agent: number | null; designated: number | null;
  amount: bigint; deadline: bigint; window: bigint; state: State;
  verdictAt: bigint | null; disputedAt: bigint | null; verdict: boolean | null;
  rent: bigint;
}
export interface Model {
  now: bigint; config: ConfigModel; missions: MissionModel[]; nextId: bigint;
}
export interface Attempt { operation: Operation; actor: number; mission?: MissionModel;
  amount?: bigint; deadline?: bigint; window?: bigint; designated?: number | null;
  other?: number; paused?: boolean; pay?: boolean; redirect: number; }
export interface Decision { pass: boolean; next?: State; recipient?: number; reason: string }
export const live = (state: State): boolean => ['open', 'accepted', 'submitted', 'passed', 'failed', 'disputed'].includes(state);
const yes = (reason: string, next?: State, recipient?: number): Decision => ({ pass: true, reason, next, recipient });
const no = (reason: string): Decision => ({ pass: false, reason });

export function decide(model: Model, attempt: Attempt, balances: readonly bigint[]): Decision {
  const { operation: op, actor, mission: m, redirect } = attempt;
  const c = model.config, now = model.now;
  if (op === 'initialize_config') return no('Config can only be initialized once');
  if (op === 'update_config') {
    return actor === c.admin && attempt.other! < 6 && attempt.window! > 0n && attempt.amount! > 0n
      ? yes('Current admin updates valid Config') : no('Admin or Config bounds');
  }
  if (op === 'propose_admin') return actor === c.admin && attempt.other! < 6 ? yes('Current admin proposes') : no('Unauthorized/default proposed admin');
  if (op === 'accept_admin') return c.pending !== null && actor === c.pending ? yes('Pending signer accepts') : no('Not pending admin');
  if (op === 'cancel_admin_proposal') return actor === c.admin && c.pending !== null ? yes('Current admin cancels existing proposal') : no('Unauthorized/no pending proposal');
  if (!m) return no('Mission absent');
  if (op === 'create_mission') {
    if (c.paused || m.client === c.validator || m.designated === c.validator || m.designated === m.client) return no('Creation role/pause guard');
    if (m.amount <= 0n || m.amount > c.cap || m.amount > balances[m.client]!) return no('Creation amount guard');
    if (m.deadline <= now || m.window < c.minWindow || m.deadline + STALE > I64_MAX || m.deadline + m.window > I64_MAX) return no('Creation time/window guard');
    if (redirect >= 0 && redirect !== m.client) return no('Wrong client token owner');
    return yes('Fresh SDK-reserved identity, valid creation', 'open');
  }
  if (!live(m.state)) return no('Absent/closed missions cannot transition');
  if (op === 'cancel_mission') {
    if (actor !== m.client || m.state !== 'open') return no('Only client cancels Open');
    if (redirect >= 0 && redirect !== m.client) return no('Wrong refund destination');
    return yes('Client cancellation', 'cancelled', m.client);
  }
  if (op === 'accept_mission') return m.state === 'open' && actor !== m.client && actor !== c.validator
    && (m.designated === null || m.designated === actor) && now < m.deadline
    ? yes('Authorized timely acceptance', 'accepted') : no('State/role/designation/deadline');
  if (op === 'submit_delivery') return m.state === 'accepted' && actor === m.agent && now < m.deadline
    ? yes('Bound agent delivers before deadline', 'submitted') : no('State/agent/deadline');
  if (op === 'record_verdict') return m.state === 'submitted' && actor === c.validator && now + m.window <= I64_MAX
    ? yes('Current validator records one verdict', attempt.pay ? 'passed' : 'failed') : no('State/validator/overflow');
  if (op === 'open_dispute') return ['passed', 'failed'].includes(m.state) && (actor === m.client || actor === m.agent)
    && m.verdictAt !== null && now < m.verdictAt + m.window && now + DISPUTE <= I64_MAX
    ? yes('Party disputes within original window', 'disputed') : no('State/party/window/overflow');
  if (op === 'refund_expired' || op === 'refund_stale') {
    const allowed = op === 'refund_expired' ? ['open', 'accepted'].includes(m.state) && now >= m.deadline
      : m.state === 'submitted' && m.verdictAt === null && now >= m.deadline + STALE;
    if (!allowed) return no('Refund state/time');
    if (redirect >= 0 && redirect !== m.client) return no('Wrong refund destination');
    return yes('Permissionless due refund', 'refunded', m.client);
  }
  if (op === 'resolve_dispute' || op === 'finalize') {
    if (m.agent === null || (redirect >= 0 && redirect !== m.agent)) return no('Wrong/missing agent destination');
    let pay = attempt.pay!;
    if (op === 'resolve_dispute') {
      if (actor !== c.admin || m.state !== 'disputed') return no('Only current admin resolves Disputed');
    } else if (m.state === 'disputed') {
      if (m.disputedAt === null || now < m.disputedAt + DISPUTE) return no('Dispute timeout not elapsed');
      pay = m.verdict!;
    } else {
      if (!['passed', 'failed'].includes(m.state) || m.verdictAt === null || now < m.verdictAt + m.window) return no('Verdict window not elapsed/state');
      pay = m.state === 'passed';
    }
    return yes('Terminal settlement', pay ? 'settled' : 'refunded', pay ? m.agent : m.client);
  }
  throw new Error('Unhandled model instruction ' + op);
}

export function apply(model: Model, attempt: Attempt, result: Decision): void {
  if (!result.pass) return;
  const c = model.config, m = attempt.mission;
  switch (attempt.operation) {
    case 'update_config': Object.assign(c, {validator: attempt.other, cap: attempt.amount, minWindow: attempt.window, paused: attempt.paused}); break;
    case 'propose_admin': c.pending = attempt.other!; break;
    case 'accept_admin': c.admin = attempt.actor; c.pending = null; break;
    case 'cancel_admin_proposal': c.pending = null; break;
    default:
      if (!m || !result.next) throw new Error('Missing model transition');
      m.state = result.next;
      if (attempt.operation === 'accept_mission') m.agent = attempt.actor;
      if (attempt.operation === 'record_verdict') { m.verdictAt = model.now; m.verdict = attempt.pay!; }
      if (attempt.operation === 'open_dispute') m.disputedAt = model.now;
  }
}

export interface ClockPlan {
  requested: bigint; actual: bigint; reference: bigint | null; available: boolean;
  clamp: 'monotonic' | 'i64-max' | null; actualOffset: bigint | null;
}
/** Report actual clock movement separately from an arbitrary's requested boundary. */
export function planClock(now: bigint, mission: MissionModel | undefined, command: Command): ClockPlan {
  let reference: bigint | null = now;
  let available = command.boundary === 'delta';
  if (command.boundary !== 'delta' && mission) {
    const anchors = { deadline: mission.deadline,
      window: (mission.verdictAt ?? now) + mission.window,
      dispute: (mission.disputedAt ?? now) + DISPUTE, stale: mission.deadline + STALE };
    reference = anchors[command.boundary];
    available = live(mission.state) && (command.boundary === 'deadline'
      || (command.boundary === 'window' && mission.verdictAt !== null)
      || (command.boundary === 'dispute' && mission.state === 'disputed' && mission.disputedAt !== null)
      || (command.boundary === 'stale' && mission.state === 'submitted' && mission.verdictAt === null));
  } else if(command.boundary !== 'delta') reference = null;
  const requested = (reference ?? now) + BigInt(command.offset);
  const clamp = requested > I64_MAX ? 'i64-max' : requested < now ? 'monotonic' : null;
  const actual = requested > I64_MAX ? I64_MAX : requested < now ? now : requested;
  return {requested,actual,reference,available,clamp,actualOffset:available && reference!==null?actual-reference:null};
}
