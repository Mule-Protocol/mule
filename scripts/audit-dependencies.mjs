#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_HASH = '6882e3d44987bbb7c47580928fd5e3be126bdaE26a448f8a31228cf879a85210'.toLowerCase();
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

/** The exception is conditional on the vulnerable native converter being absent.
 * Resolve candidate binding paths WITHOUT loading any native binary. */
export function verifyBigintFallback(root = ROOT) {
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const ignored = workspace.match(/^ignoredBuiltDependencies:[ \t]*\r?\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1] ?? '';
  assert(/^[ \t]+-[ \t]+['"]?bigint-buffer['"]?[ \t]*$/m.test(ignored), 'bigint-buffer build scripts must be explicitly ignored');
  const runnerRequire = createRequire(join(root, 'packages/runner/package.json'));
  const splRequire = createRequire(runnerRequire.resolve('@solana/spl-token'));
  const layoutRequire = createRequire(splRequire.resolve('@solana/buffer-layout-utils'));
  const entry = layoutRequire.resolve('bigint-buffer');
  const packageRoot = dirname(dirname(entry));
  assert.equal(json(join(packageRoot, 'package.json')).version, '1.1.5', 'Review exception when bigint-buffer changes');
  assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'), ENTRY_HASH, 'Unexpected bigint-buffer fallback code');
  const bigintRequire = createRequire(entry);
  const bindings = bigintRequire('bindings');
  try {
    bindings({ bindings: 'bigint_buffer', module_root: packageRoot, path: true });
    throw new Error('Native bigint-buffer binding exists: temporary audit exception is invalid');
  } catch (error) {
    if (!Array.isArray(error.tries) || error.tries.length === 0 || error.tries.some((path) => existsSync(path))) throw error;
  }
  // The verified source can now only take its pure-JS converter path.
  const fallback = bigintRequire(entry);
  for (const length of [0, 1, 7, 8, 31, 32, 33, 128]) {
    const buffer = Buffer.alloc(length, 0xab);
    const expected = length === 0 ? 0n : BigInt('0x' + Buffer.from(buffer).reverse().toString('hex'));
    assert.equal(fallback.toBigIntLE(buffer), expected);
  }
  return { package: 'bigint-buffer', version: '1.1.5', nativeBindingAbsent: true, entrySha256: ENTRY_HASH, lengthsChecked: [0, 1, 7, 8, 31, 32, 33, 128] };
}

export function assessAudits(npm, cargo, policy, options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  assert.equal(policy.schemaVersion, 1, 'Unsupported exception schema');
  assert(Array.isArray(policy.exceptions), 'Exceptions must be an array');
  assert(npm && typeof npm.advisories === 'object' && npm.advisories !== null && npm.metadata?.vulnerabilities, 'Invalid or failed pnpm audit response');
  assert(cargo && Array.isArray(cargo.vulnerabilities?.list) && typeof cargo.vulnerabilities.count === 'number' && cargo.database, 'Invalid or failed cargo audit response');
  assert.equal(cargo.vulnerabilities.count, cargo.vulnerabilities.list.length, 'Inconsistent cargo audit response');
  const seen = new Set();
  for (const exception of policy.exceptions) {
    assert(['npm', 'cargo'].includes(exception.ecosystem), 'Invalid exception ecosystem');
    assert(typeof exception.advisory === 'string' && /^(GHSA-|RUSTSEC-)/.test(exception.advisory));
    assert(typeof exception.package === 'string' && exception.package.length > 0);
    assert(Array.isArray(exception.versions) && exception.versions.length > 0 && exception.versions.every((v) => typeof v === 'string' && /^\d/.test(v)), 'Exceptions require exact versions');
    assert(typeof exception.reason === 'string' && exception.reason.length >= 40, 'Exception requires a concrete reason');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(exception.reviewBy) && exception.reviewBy >= today, 'Expired or invalid exception: ' + exception.advisory);
    const key = exception.ecosystem + ':' + exception.advisory + ':' + exception.package;
    assert(!seen.has(key), 'Duplicate exception');
    seen.add(key);
    if (exception.mitigation) assert(options.mitigations?.[exception.mitigation] === true, 'Unverified exception mitigation: ' + exception.mitigation);
  }
  const findings = [];
  for (const advisory of Object.values(npm.advisories)) {
    assert(typeof advisory.github_advisory_id === 'string' && typeof advisory.module_name === 'string'
      && Array.isArray(advisory.findings) && advisory.findings.length > 0, 'Incomplete npm advisory');
    for (const finding of advisory.findings) {
      assert(typeof finding.version === 'string' && Array.isArray(finding.paths), 'Incomplete npm finding');
      findings.push({ ecosystem: 'npm', advisory: advisory.github_advisory_id, package: advisory.module_name,
        version: finding.version, severity: advisory.severity, title: advisory.title, paths: finding.paths });
    }
  }
  for (const finding of cargo.vulnerabilities.list) findings.push({
    ecosystem: 'cargo', advisory: finding.advisory.id, package: finding.package.name, version: finding.package.version,
    severity: 'vulnerability', title: finding.advisory.title,
  });
  for (const finding of findings) {
    const exception = policy.exceptions.find((item) => item.ecosystem === finding.ecosystem && item.advisory === finding.advisory
      && item.package === finding.package && item.versions.includes(finding.version));
    finding.disposition = exception ? 'temporary-exception' : finding.ecosystem === 'cargo'
      || !['info', 'low', 'moderate', 'medium'].includes(finding.severity) ? 'blocking' : 'reported';
    if (exception) finding.reviewBy = exception.reviewBy;
  }
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), policy: 'npm high/critical/unknown block; all RustSec vulnerabilities block; informational warnings retained',
    passed: findings.every((finding) => finding.disposition !== 'blocking'), findings,
    rawNpmCounts: npm.metadata.vulnerabilities, cargoDatabase: cargo.database, cargoWarnings: cargo.warnings ?? {},
    exceptions: policy.exceptions, mitigations: options.mitigations ?? {} };
}

function runJson(command, args, name, outputDirectory) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'pnpm.cmd' });
  if (result.error) throw result.error;
  writeFileSync(join(outputDirectory, name + '.json'), result.stdout || '{}');
  if (result.signal || ![0, 1].includes(result.status)) throw new Error(name + ' scanner failed: ' + (result.stderr || result.signal || result.status));
  try { return JSON.parse(result.stdout); } catch { throw new Error(name + ' did not return valid JSON: ' + result.stderr); }
}

export function main() {
  const output = join(ROOT, 'coverage/audit');
  mkdirSync(output, { recursive: true });
  const policy = json(join(ROOT, 'docs/testing/audit-exceptions.json'));
  let npm, cargo;
  const args = process.argv.slice(2);
  if (args[0] === '--from-files' && args.length === 3) {
    npm = json(resolve(args[1])); cargo = json(resolve(args[2]));
    writeFileSync(join(output, 'pnpm.json'), JSON.stringify(npm, null, 2) + '\n');
    writeFileSync(join(output, 'cargo.json'), JSON.stringify(cargo, null, 2) + '\n');
  } else {
    assert.equal(args.length, 0, 'Usage: audit-dependencies.mjs [--from-files pnpm.json cargo.json]');
    const cargoCommand = process.env.MULE_CARGO_AUDIT ?? 'cargo-audit';
    const version = spawnSync(cargoCommand, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, 'cargo-audit binary unavailable');
    assert.equal(version.stdout.trim(), 'cargo-audit 0.22.2', 'Unexpected cargo-audit version');
    npm = runJson(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--prod', '--json'], 'pnpm', output);
    const database = join(process.env.RUNNER_TEMP ?? dirname(ROOT), 'mule-rustsec-advisory-db');
    cargo = runJson(cargoCommand, ['audit', '--db', database, '--no-yanked', '--json'], 'cargo', output);
  }
  const mitigations = {};
  let bigintEvidence;
  if (policy.exceptions.some((exception) => exception.mitigation === 'bigint-buffer-js-only')) {
    bigintEvidence = verifyBigintFallback();
    mitigations['bigint-buffer-js-only'] = true;
  }
  const summary = assessAudits(npm, cargo, policy, { mitigations });
  if (bigintEvidence) summary.bigintFallbackEvidence = bigintEvidence;
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
