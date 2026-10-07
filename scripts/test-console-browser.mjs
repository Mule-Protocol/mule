import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createDelivery } from '../packages/agent/dist/index.js';
import { loadFixture, LocalContentStore } from '../packages/validator/dist/index.js';
import { prepareValidationReport } from '../packages/runner/dist/validate.js';

const directory = 'coverage/console-browser';
mkdirSync(directory, { recursive: true });
const store = new LocalContentStore(directory + '/node-data');
const cases = ['invoice', 'contract', 'address'].flatMap(template =>
  ['honest', 'dishonest'].map(behavior => ({ template, behavior, designated: false })));
cases.push({ template: 'invoice', behavior: 'honest', designated: true });
const reference = row => 'SIM-MISSION-' + row.template + '-' + row.behavior + (row.designated ? '-designated' : '');
const expected = [];
for (const row of cases) {
  const fixture = loadFixture(row.template + '.v1');
  const criteria = store.put(fixture.criteria);
  const delivery = store.put(await createDelivery(fixture.criteria.model, row.behavior, fixture.input));
  const { report, stored } = prepareValidationReport(store, {
    mission: reference(row), criteriaHash: criteria.hash, criteriaUri: criteria.uri,
    deliveryHash: delivery.hash, deliveryUri: delivery.uri,
  });
  expected.push({ ...row, missionReference: reference(row), message: report.message, pass: report.pass,
    artifacts: Object.fromEntries(Object.entries({ criteria, delivery, report: stored }).map(([kind, object]) =>
      [kind, { json: readFileSync(object.path, 'utf8'), hash: object.hash }])) });
}
const moduleBytes = readFileSync('packages/console-core/dist/console-core.mjs');
const harness = `
import { prepareMission, runMission } from '/console-core.mjs';
const cases = ${JSON.stringify(cases)};
window.violations = [];
window.addEventListener('securitypolicyviolation', event => {
  window.violations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
});
document.getElementById('control').addEventListener('click', () => {
  try { new Function('return 1')(); window.controlBlocked = false; }
  catch (error) { window.controlBlocked = error.name === 'EvalError'; }
});
document.getElementById('run').addEventListener('click', async () => {
  try {
    const results = [];
    for (const row of cases) {
      const missionReference = 'SIM-MISSION-' + row.template + '-' + row.behavior + (row.designated ? '-designated' : '');
      const prepared = await prepareMission(row.template, row.behavior, {
        missionReference, designatedAgent: row.designated ? 'agent' : null,
      });
      const steps = [];
      if (!row.designated) for await (const step of runMission(row.template, row.behavior)) steps.push(step);
      results.push({ ...row, missionReference, artifacts: prepared.artifacts,
        trace: prepared.trace, final: prepared.final, steps });
    }
    window.results = JSON.parse(JSON.stringify(results, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  } catch (error) { window.failure = error.stack || String(error); }
  window.done = true;
});
window.ready = true;
`;
const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Console-core parity</title></head><body><button id="control">CSP control</button><button id="run">Run browser parity</button><script type="module" src="/harness.mjs"></script></body></html>';
const csp = "default-src 'none'; script-src 'self'; connect-src 'none'; img-src data:; base-uri 'none'; object-src 'none'";
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const content = request.url === '/' ? html : request.url === '/harness.mjs' ? harness
    : request.url === '/console-core.mjs' ? moduleBytes : null;
  if (content === null) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', request.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
  response.end(content);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [], requests = [];
  let measuring = false;
  page.on('pageerror', error => { if (measuring) errors.push(error.message); });
  page.on('console', message => { if (measuring && message.type() === 'error') errors.push(message.text()); });
  context.on('request', request => { if (measuring) requests.push(request.url()); });
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.ready === true);
  await page.getByRole('button', { name: 'CSP control', exact: true }).click();
  await page.waitForFunction(() => globalThis.controlBlocked !== undefined);
  assert.equal(await page.evaluate(() => globalThis.controlBlocked), true, 'CSP must block a real event-handler Function constructor');
  await page.waitForFunction(() => globalThis.violations.length > 0);
  const controlViolations = await page.evaluate(() => globalThis.violations);
  await page.evaluate(() => { globalThis.violations = []; });
  // Resources are loaded. The actual bundle must now work offline without a request.
  await context.setOffline(true);
  measuring = true;
  await page.getByRole('button', { name: 'Run browser parity', exact: true }).click();
  await page.waitForFunction(() => globalThis.done === true);
  const actual = await page.evaluate(() => ({ results: globalThis.results, failure: globalThis.failure, violations: globalThis.violations }));
  assert.equal(actual.failure, undefined, actual.failure);
  assert.deepEqual(actual.violations, [], 'No CSP violation during module execution');
  assert.deepEqual(errors, [], 'No browser errors during module execution');
  assert.deepEqual(requests, [], 'No network request during any mission');
  assert.equal(actual.results.length, expected.length);
  const proof = [];
  for (let index = 0; index < expected.length; index++) {
    const node = expected[index], browserResult = actual.results[index];
    assert.equal(browserResult.missionReference, node.missionReference);
    const artifactProof = {};
    for (const kind of ['criteria', 'delivery', 'report']) {
      const nodeBytes = Buffer.from(node.artifacts[kind].json, 'utf8');
      const browserBytes = Buffer.from(browserResult.artifacts[kind].json, 'utf8');
      assert.deepEqual(browserBytes, nodeBytes, node.missionReference + ' ' + kind + ' canonical bytes');
      assert.equal(browserResult.artifacts[kind].hash, node.artifacts[kind].hash, kind + ' SHA-256');
      artifactProof[kind] = { byteIdentical: true, utf8Bytes: nodeBytes.length, sha256: node.artifacts[kind].hash };
    }
    assert.equal(browserResult.artifacts.report.value.message, node.message);
    assert.equal(browserResult.artifacts.report.value.pass, node.pass);
    assert.equal(browserResult.final.status, node.pass ? 'settled' : 'refunded');
    if (!node.designated) {
      const steps = browserResult.steps;
      assert.deepEqual(steps.map(step => step.station), [1, 2, 3, 4, 5]);
      assert.equal(steps[3].text, 'INSPECTION · ' + node.message);
      assert.equal(steps[3].failed, !node.pass);
      assert.equal(steps[4].outcome, node.pass ? 'settled' : 'returned');
      assert.match(steps[0].text, /^ESCROW LOCKED · 5\.00 dUSDC · SIM-TX-LOCK-[a-f0-9]{8}$/);
      assert.match(steps[2].text, /^DELIVERY SUBMITTED · sha256:[a-f0-9]{4}…[a-f0-9]{4}$/);
      assert.match(steps[4].text, / · SIM-TX-CLOSE-[a-f0-9]{8}$/);
      assert.deepEqual(steps[4].report, browserResult.artifacts.report.value);
      assert.deepEqual(steps[4].hashes, Object.fromEntries(['criteria', 'delivery', 'report'].map(kind => [kind, node.artifacts[kind].hash])));
      for (const step of steps) {
        assert(!step.text.includes('FAKE_'));
        assert(!/[1-9A-HJ-NP-Za-km-z]{32,88}/.test(step.text), 'Displayed text must not resemble a Solana address/signature');
      }
    }
    proof.push({ template: node.template, behavior: node.behavior, designatedAgent: node.designated,
      missionReference: node.missionReference, passed: true, validatorMessage: node.message,
      finalStatus: browserResult.final.status, artifacts: artifactProof,
      stepInterfaceChecked: !node.designated });
  }
  const summary = { schemaVersion: 1, passed: true, engine: 'real headless Chromium ' + browser.version(),
    bundleSha256: createHash('sha256').update(moduleBytes).digest('hex'), csp,
    cspNegativeControlBlocked: true, controlViolations,
    cspViolationsDuringMissions: [], browserErrorsDuringMissions: [], networkRequestsDuringMissions: [],
    offlineDuringMissions: true, scenarios: proof };
  writeFileSync(directory + '/summary.json', JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(directory + '/parity.json', JSON.stringify({ node: expected, browser: actual.results }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
