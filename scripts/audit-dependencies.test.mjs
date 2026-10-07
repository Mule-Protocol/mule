import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAudits } from './audit-dependencies.mjs';
const cargo = { database: { 'last-commit': 'test' }, vulnerabilities: { count: 0, list: [] }, warnings: {} };
const policy = { schemaVersion: 1, exceptions: [] };
const report = (severity = 'high', version = '1.0.0') => ({ advisories: { a: {
  github_advisory_id: 'GHSA-test-test-test', module_name: 'example', severity, title: 'Example vulnerability',
  findings: [{ version, paths: ['runner>example'] }],
} }, metadata: { vulnerabilities: { high: severity === 'high' ? 1 : 0 } } });
const exception = { ecosystem: 'npm', advisory: 'GHSA-test-test-test', package: 'example', versions: ['1.0.0'],
  reason: 'A concrete narrowly scoped mitigation checked before the exception is applied.', reviewBy: '2026-11-06', mitigation: 'checked' };
test('high, critical and unknown npm severities fail closed; moderate remains visible', () => {
  for (const severity of ['high', 'critical', 'unexpected', undefined]) assert.equal(assessAudits(report(severity), cargo, policy).passed, false);
  const result = assessAudits(report('moderate'), cargo, policy);
  assert.equal(result.passed, true); assert.equal(result.findings[0].disposition, 'reported');
});
test('exceptions require matching advisory/package/exact version and verified mitigation', () => {
  const p = { ...policy, exceptions: [exception] };
  assert.throws(() => assessAudits(report(), cargo, p, { today: '2026-10-07' }), /Unverified/);
  const options = { today: '2026-10-07', mitigations: { checked: true } };
  assert.equal(assessAudits(report(), cargo, p, options).findings[0].disposition, 'temporary-exception');
  assert.equal(assessAudits(report('high', '1.0.1'), cargo, p, options).passed, false);
  assert.throws(() => assessAudits(report(), cargo, p, { ...options, today: '2026-11-07' }), /Expired/);
});
test('scanner errors and malformed output cannot pass', () => {
  assert.throws(() => assessAudits({ error: 'registry unavailable' }, cargo, policy), /pnpm/);
  assert.throws(() => assessAudits(report(), { error: 'database unavailable' }, policy), /cargo/);
  assert.throws(() => assessAudits(report(), { ...cargo, vulnerabilities: { count: 1, list: [] } }, policy), /Inconsistent/);
});
test('RustSec vulnerabilities block independently of informational warnings', () => {
  const result = assessAudits({ advisories: {}, metadata: { vulnerabilities: {} } },
    { ...cargo, vulnerabilities: { count: 1, list: [{ advisory: { id: 'RUSTSEC-2026-0001', title: 'Example' },
      package: { name: 'example', version: '1.0.0' } }] } }, policy);
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].ecosystem, 'cargo');
});
