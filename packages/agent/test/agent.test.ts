import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFixture, MODELS, validateDelivery, type JsonValue } from '@mule/validator';
import { createDelivery, ScriptedAgent, type DeliveryProducer } from '../src/index.js';

for (const model of MODELS) {
  test(model + ': reference agent is deterministic, honest passes and input is preserved', async () => {
    const { input, criteria } = loadFixture(model);
    const original = structuredClone(input);
    const agent = new ScriptedAgent();
    const output = await agent.produce({ model, mode: 'honest', input });
    assert.deepEqual(await agent.produce({ model, mode: 'honest', input }), output);
    assert.deepEqual(input, original);
    assert.equal(agent.description, 'agent de référence scripté');
    assert.equal(validateDelivery({ mission: 'fixture', criteria, delivery: output }).pass, true);
  });
  test(model + ': dishonest mode changes exactly the prescribed field', async () => {
    const good = await createDelivery(model, 'honest') as Record<string, JsonValue>;
    const bad = await createDelivery(model, 'dishonest') as Record<string, JsonValue>;
    assert.equal(validateDelivery({ mission: 'fixture', criteria: loadFixture(model).criteria, delivery: bad }).pass, false);
    if (model === 'invoice.v1') {
      assert.equal(Object.hasOwn(bad, 'total_amount'), false);
      bad.total_amount = good.total_amount!;
    } else if (model === 'contract.v1') {
      assert.equal(Object.hasOwn(bad, 'governing_law'), false);
      bad.governing_law = good.governing_law!;
    } else {
      const badRows = bad.rows as Record<string, JsonValue>[];
      const goodRows = good.rows as Record<string, JsonValue>[];
      assert.equal(badRows[6]!.postcode, 'INVALID');
      badRows[6]!.postcode = goodRows[6]!.postcode!;
    }
    assert.deepEqual(bad, good);
  });
}
test('address normalization removes whitespace while preserving the leading zero', async () => {
  const output = await createDelivery('address.v1', 'honest') as Record<string, JsonValue>;
  assert.equal((output.rows as Record<string, JsonValue>[])[0]!.postcode, '01000');
});
test('delivery producer can be replaced without changing orchestration', async () => {
  const calls: unknown[] = [];
  const replacement: DeliveryProducer = {
    description: 'test plug-in',
    async produce(request) { calls.push(request); return { replacement: true }; },
  };
  const input = { explicit: 'input' };
  assert.deepEqual(await createDelivery('invoice.v1', 'honest', input, replacement), { replacement: true });
  assert.deepEqual(calls, [{ model: 'invoice.v1', mode: 'honest', input }]);
});

test('dishonest mode rejects inputs where its prescribed corruption would make no change', async () => {
  for (const [model, field] of [['invoice.v1', 'total_amount'], ['contract.v1', 'governing_law']] as const) {
    const input = structuredClone(loadFixture(model).input) as Record<string, JsonValue>;
    delete input[field];
    await assert.rejects(() => createDelivery(model, 'dishonest', input), /already missing/);
  }
  const input = structuredClone(loadFixture('address.v1').input) as Record<string, JsonValue>;
  (input.rows as Record<string, JsonValue>[])[6]!.postcode = 'INVALID';
  await assert.rejects(() => createDelivery('address.v1', 'dishonest', input), /already invalid/);
});
