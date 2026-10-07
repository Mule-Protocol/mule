import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, createValidator, ScriptedAgent } from '@mule/mission-logic';
import { loadFixture, MODELS, validateDelivery } from '../src/index.js';

// Dynamic imports preserve the validator package's CommonJS API while loading
// the browser's actual ESM standalone validators, not a second runtime compiler.
const standalone = Promise.all([
  import('../../console-core/src/generated/fixtures.js'),
  import('../../console-core/src/generated/validators.js'),
]).then(([fixtures, schemas]) => ({
  fixtureFor: fixtures.fixtureFor,
  schemaValidator: schemas.schemaValidator,
  validate: createValidator({ fixtureFor: fixtures.fixtureFor, schemaValidator: schemas.schemaValidator }),
}));

for (const model of MODELS) {
  test(model + ': Node and standalone preserve fixture bytes and all eleven complete reports', async () => {
    const browser = await standalone;
    const fixture = browser.fixtureFor(model);
    assert.equal(canonicalJson(fixture), canonicalJson(loadFixture(model)), 'Generated fixture must match the source fixture');
    const agent = new ScriptedAgent();
    const deliveries: Array<{ label: string; value: unknown }> = [];
    for (const mode of ['honest', 'dishonest'] as const) {
      deliveries.push({ label: mode, value: await agent.produce({ model, mode, input: fixture.input }) });
    }
    deliveries.push(
      { label: 'null root', value: null },
      { label: 'boolean root', value: false },
      { label: 'array root', value: [] },
      { label: 'number root', value: 1 },
      { label: 'string root', value: 'text' },
      { label: 'empty object', value: {} },
      { label: 'source input before normalization', value: fixture.input },
      { label: 'additional field', value: { ...fixture.input as object, extra: 'no' } },
      { label: 'impossible dates and foreign fields', value: { ...fixture.input as object, date: '2026-02-30', effective_date: '2026-02-30' } },
    );
    assert.equal(deliveries.length, 11);
    for (const { label, value } of deliveries) {
      const request = { mission: 'fixture-mission', criteria: fixture.criteria, delivery: value,
        criteriaHash: 'a'.repeat(64), deliveryHash: 'b'.repeat(64) };
      // Include ordered checks, Ajv error details/paths, exact message and bound hashes.
      assert.equal(canonicalJson(browser.validate(request)), canonicalJson(validateDelivery(request)), model + ': ' + label);
    }
  });
}

test('standalone lookup rejects unknown schemas and caller-mutated criteria without weakening reviewed fixtures', async () => {
  const browser = await standalone;
  assert.throws(() => browser.schemaValidator({}), /compiled at build time/);
  const fixture = browser.fixtureFor('invoice.v1');
  fixture.criteria.crossChecks.length = 0;
  assert.throws(() => browser.validate({ mission: 'fixture-mission', criteria: fixture.criteria, delivery: fixture.input }), /Unsupported criteria/);
  assert.equal(canonicalJson(browser.fixtureFor('invoice.v1')), canonicalJson(loadFixture('invoice.v1')));
});
