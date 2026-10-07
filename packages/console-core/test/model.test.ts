import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EscrowModel, EscrowModelError, MAX_I64, MAX_U64, STALE_SECONDS, type ModelTerms } from '../src/model.js';
const hash = 'a'.repeat(64), deliveryHash = 'b'.repeat(64), reportHash = 'c'.repeat(64);
const now = 1_700_000_000n;
const terms: ModelTerms = { amount: 5_000_000n, deadline: now + 600n, window: 60n, criteriaHash: hash, designatedAgent: null };
function rejected(model: EscrowModel, action: () => unknown, code: string): void {
  const before = model.snapshot(), entries = model.trace;
  assert.throws(action, error => error instanceof EscrowModelError && error.code === code);
  assert.deepEqual(model.snapshot(), before);
  assert.deepEqual(model.trace, entries);
}
function started(designatedAgent: ModelTerms['designatedAgent'] = null): EscrowModel {
  const model = new EscrowModel(); model.create('client', { ...terms, designatedAgent }, now); return model;
}
function submitted(): EscrowModel {
  const model = started(); model.accept('agent', now); model.submit('agent', deliveryHash, now); return model;
}

test('creation rejects invalid roles, caps, balances, pause, deadlines and arithmetic overflow without changes', () => {
  const model = new EscrowModel();
  rejected(model, () => model.create('validator', terms, now), 'ValidatorCannotBeClient');
  rejected(model, () => model.create('client', { ...terms, designatedAgent: 'client' }, now), 'ClientCannotDesignateSelf');
  rejected(model, () => model.create('client', { ...terms, designatedAgent: 'validator' }, now), 'ValidatorCannotBeDesignatedAgent');
  rejected(model, () => model.create('client', { ...terms, amount: 0n }, now), 'InvalidAmount');
  rejected(model, () => model.create('client', { ...terms, amount: 100_000_001n }, now), 'InvalidAmount');
  rejected(model, () => model.create('client', { ...terms, amount: MAX_U64 + 1n }, now), 'U64OutOfRange');
  rejected(model, () => model.create('client', { ...terms, deadline: now }, now), 'InvalidDeadline');
  rejected(model, () => model.create('client', { ...terms, deadline: MAX_I64 }, now), 'ArithmeticOverflow');
  rejected(model, () => model.create('client', { ...terms, window: 59n }, now), 'InvalidWindow');
  const poor = new EscrowModel({ clientBalance: 1n });
  rejected(poor, () => poor.create('client', terms, now), 'InsufficientFunds');
  const paused = new EscrowModel({ config: { paused: true } });
  rejected(paused, () => paused.create('client', terms, now), 'Paused');
  assert.equal(model.create('client', terms, now).after.balances.vault, terms.amount);
});

test('only the designated agent accepts; unrestricted acceptance excludes client and validator', () => {
  const model = started('agent');
  rejected(model, () => model.accept('client', now), 'ClientCannotAccept');
  rejected(model, () => model.accept('validator', now), 'ValidatorCannotAccept');
  rejected(model, () => model.accept('outsider', now), 'NotDesignatedAgent');
  rejected(model, () => model.accept('agent', terms.deadline), 'DeadlinePassed');
  assert.equal(model.accept('agent', terms.deadline - 1n).after.agent, 'agent');
  rejected(model, () => model.accept('agent', now), 'InvalidState');
  assert.equal(started().accept('outsider', now).after.agent, 'outsider');
});

test('delivery binds the accepted agent and rejects the exact deadline', () => {
  const model = started(); model.accept('agent', now);
  rejected(model, () => model.submit('outsider', deliveryHash, now), 'UnauthorizedAgent');
  rejected(model, () => model.submit('agent', deliveryHash, terms.deadline), 'DeadlinePassed');
  assert.equal(model.submit('agent', deliveryHash, terms.deadline - 1n).after.status, 'submitted');
  rejected(model, () => model.submit('agent', deliveryHash, now), 'InvalidState');
});

for (const passed of [true, false]) {
  test(`verdict ${passed}: one authorized report, settlement at exact window and closed replay rejected`, () => {
    const model = submitted();
    rejected(model, () => model.recordVerdict('agent', passed, reportHash, now), 'UnauthorizedValidator');
    rejected(model, () => model.recordVerdict('validator', passed, reportHash, MAX_I64), 'ArithmeticOverflow');
    // Verdicts may arrive after the delivery deadline; their own window starts here.
    const verdictAt = terms.deadline + 1n;
    assert.equal(model.recordVerdict('validator', passed, reportHash, verdictAt).after.reportHash, reportHash);
    rejected(model, () => model.recordVerdict('validator', passed, reportHash, verdictAt), 'InvalidState');
    rejected(model, () => model.finalize('outsider', verdictAt + terms.window - 1n), 'DisputeWindowActive');
    const end = model.finalize('outsider', verdictAt + terms.window);
    assert.equal(end.after.status, passed ? 'settled' : 'refunded');
    assert.deepEqual(end.delta, { client: passed ? 0n : terms.amount, agent: passed ? terms.amount : 0n, vault: -terms.amount });
    rejected(model, () => model.finalize('outsider', verdictAt + terms.window + 1n), 'InvalidState');
    rejected(model, () => model.create('client', terms, now), 'InvalidState');
    rejected(model, () => model.refund('outsider', 'expired', terms.deadline), 'InvalidState');
  });
}

test('expired refunds recover open and accepted missions exactly at the deadline', () => {
  for (const accepted of [false, true]) {
    const model = started(); if (accepted) model.accept('agent', now);
    rejected(model, () => model.refund('outsider', 'expired', terms.deadline - 1n), 'DeadlineNotReached');
    const end = model.refund('outsider', 'expired', terms.deadline);
    assert.equal(end.instruction, 'refund_expired');
    assert.deepEqual(end.after.balances, { client: 100_000_000n, agent: 0n, vault: 0n });
  }
});

test('stale refunds require a submitted mission without a verdict and the exact seven-day boundary', () => {
  const model = submitted(), boundary = terms.deadline + STALE_SECONDS;
  rejected(model, () => model.refund('outsider', 'expired', boundary), 'InvalidState');
  rejected(model, () => model.refund('outsider', 'stale', boundary - 1n), 'StaleTimeoutNotReached');
  assert.equal(model.refund('outsider', 'stale', boundary).after.status, 'refunded');
  const verdict = submitted(); verdict.recordVerdict('validator', false, reportHash, now);
  rejected(verdict, () => verdict.refund('outsider', 'stale', boundary), 'InvalidState');
});

test('BigInt token transfers preserve values beyond Number precision and fail on destination overflow', () => {
  const amount = (1n << 53n) + 1n;
  const model = new EscrowModel({ clientBalance: amount, config: { maxAmount: MAX_U64 } });
  model.create('client', { ...terms, amount }, now); model.accept('agent', now);
  model.submit('agent', deliveryHash, now); model.recordVerdict('validator', true, reportHash, now);
  assert.equal(model.finalize('outsider', now + terms.window).after.balances.agent, amount);
  const overflow = new EscrowModel({ agentBalance: MAX_U64 });
  overflow.create('client', terms, now); overflow.accept('agent', now);
  overflow.submit('agent', deliveryHash, now); overflow.recordVerdict('validator', true, reportHash, now);
  rejected(overflow, () => overflow.finalize('outsider', now + terms.window), 'ArithmeticOverflow');
});
