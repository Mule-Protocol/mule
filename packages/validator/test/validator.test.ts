import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFixture, MODELS, decimalCents, validateDelivery, type Model, type Criteria } from '../src/index.js';

function honest(model: Model): Record<string, unknown> {
  const input = structuredClone(loadFixture(model).input) as Record<string, unknown>;
  if (model === 'address.v1') {
    const rows = input.rows as Record<string, string>[];
    rows.forEach(row => { row.postcode = row.postcode!.replace(/\s/g, ''); });
  }
  return input;
}
function validate(model: Model, delivery: unknown) {
  return validateDelivery({ mission: 'fixture-mission', criteria: loadFixture(model).criteria, delivery });
}
for (const model of MODELS) {
  test(model + ': honest fixture satisfies draft 2020-12 schema and all named checks', () => {
    const report = validate(model, honest(model));
    assert.equal(report.pass, true);
    assert.equal(report.agent, 'agent de référence scripté');
    assert.equal(report.schema, model);
    assert.equal(report.mission, 'fixture-mission');
    assert.ok(report.results.every(check => check.pass));
    assert.equal(report.message, model === 'invoice.v1' ? '6/6 FIELDS VALID' : model === 'contract.v1' ? '5/5 FIELDS VALID' : '12/12 ROWS VALID');
  });
}
test('invoice dishonest output has exactly the console failure message', () => {
  const delivery = honest('invoice.v1');
  delete delivery.total_amount;
  const report = validate('invoice.v1', delivery);
  assert.equal(report.pass, false);
  assert.equal(report.message, '5/6 · MISSING: total_amount');
});
test('contract dishonest output has exactly the console failure message', () => {
  const delivery = honest('contract.v1');
  delete delivery.governing_law;
  const report = validate('contract.v1', delivery);
  assert.equal(report.pass, false);
  assert.equal(report.message, '4/5 · MISSING: governing_law');
});
test('address dishonest row 7 has exactly the console failure message', () => {
  const delivery = honest('address.v1');
  (delivery.rows as Record<string, string>[])[6]!.postcode = 'INVALID';
  const report = validate('address.v1', delivery);
  assert.equal(report.pass, false);
  assert.equal(report.message, '11/12 · INVALID POSTCODE, ROW 7');
  assert.equal(report.results.filter(check => check.check.startsWith('row.') && !check.pass).length, 1);
});
test('invoice cross-check handles 0.10 + 0.20 exactly and rejects a one-cent mismatch', () => {
  const delivery = honest('invoice.v1');
  delivery.total_amount = '0.30';
  delivery.line_items = [{ description: 'A', amount: '0.10' }, { description: 'B', amount: '0.20' }];
  assert.equal(validate('invoice.v1', delivery).pass, true);
  delivery.total_amount = '0.31';
  const report = validate('invoice.v1', delivery);
  assert.equal(report.pass, false);
  assert.equal(report.message, '6/6 · TOTAL MISMATCH');
  assert.equal(report.results.find(result => result.check === 'invoice.total_matches_lines')!.pass, false);
});
test('decimal comparison is exact above Number.MAX_SAFE_INTEGER and rejects lossy inputs', () => {
  assert.equal(decimalCents('999999999999999999.99'), 99999999999999999999n);
  for (const amount of [0.30, '1.001', '1', '-0.01', '01.00', '1e2', Infinity, '1000000000000000000.00']) {
    assert.throws(() => decimalCents(amount));
  }
  const delivery = honest('invoice.v1');
  delivery.total_amount = '999999999999999999.99';
  delivery.line_items = [{ description: 'Large', amount: '999999999999999999.98' }, { description: 'Cent', amount: '0.01' }];
  assert.equal(validate('invoice.v1', delivery).pass, true);
});
test('invoice never coerces types or accepts impossible dates or additional fields', () => {
  for (const mutation of [
    { total_amount: 123.45 }, { date: '2026-02-30' }, { total_amount: '123.451' },
    { currency: 'eur' }, { extra: 'field' }, { supplier: '' },
  ]) {
    assert.equal(validate('invoice.v1', { ...honest('invoice.v1'), ...mutation }).pass, false);
  }
});
test('contract enforces five fields, distinct parties and a real date', () => {
  for (const mutation of [
    { governing_law: '' }, { effective_date: '2026-02-30' }, { parties: ['One', 'One'] },
    { termination: '' }, { sixth_field: 'extra' },
  ]) {
    assert.equal(validate('contract.v1', { ...honest('contract.v1'), ...mutation }).pass, false);
  }
});
test('address requires exactly 12 rows, string normalized postcodes, and the declared country', () => {
  const delivery = honest('address.v1');
  assert.equal((delivery.rows as Record<string, string>[])[0]!.postcode, '01000');
  assert.equal(validate('address.v1', { rows: (delivery.rows as unknown[]).slice(1) }).pass, false);
  assert.equal(validate('address.v1', { rows: [...delivery.rows as unknown[], (delivery.rows as unknown[])[0]] }).pass, false);
  for (const mutation of [{ postcode: 1000 }, { postcode: ' 75001' }, { postcode: '７５００１' }, { country: 'GB' }]) {
    const rows = structuredClone(delivery.rows as Record<string, unknown>[]);
    Object.assign(rows[0]!, mutation);
    assert.equal(validate('address.v1', { rows }).pass, false);
  }
});
test('all malformed delivery root types fail closed without throwing a false pass', () => {
  for (const model of MODELS) {
    for (const value of [null, false, [], 1, 'text', {}]) assert.equal(validate(model, value).pass, false);
  }
});
test('criteria are pinned to reviewed template versions and known cross-checks', () => {
  const criteria = loadFixture('invoice.v1').criteria;
  const request = { mission: 'm', delivery: honest('invoice.v1') };
  assert.throws(() => validateDelivery({ ...request, criteria: { ...criteria, schema: {} } }), /Unsupported criteria/);
  assert.throws(() => validateDelivery({ ...request, criteria: { ...criteria, crossChecks: [] } }), /Unsupported criteria/);
  assert.throws(() => validateDelivery({ ...request, criteria: { ...criteria, model: 'arbitrary.v1' } as unknown as Criteria }), /Unsupported/);
});
test('validation is deterministic, includes hashes and does not mutate its input', () => {
  const delivery = honest('invoice.v1');
  const before = structuredClone(delivery);
  const request = { mission: 'm', criteria: loadFixture('invoice.v1').criteria, delivery, criteriaHash: 'a'.repeat(64), deliveryHash: 'b'.repeat(64) };
  assert.deepEqual(validateDelivery(request), validateDelivery(request));
  assert.deepEqual(delivery, before);
  assert.equal(validateDelivery(request).criteria_hash, request.criteriaHash);
  assert.equal(validateDelivery(request).delivery_hash, request.deliveryHash);
});
