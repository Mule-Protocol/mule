import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, contentUri, LocalContentStore, loadFixture, sha256, validateDelivery } from '../src/index.js';

test('content store deduplicates deterministic JSON, produces exact main URI and reads locally', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mule-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalContentStore(directory);
  const one = store.put({ b: 2, nested: { z: false, a: 'é' }, a: 1 });
  const two = store.put({ a: 1, nested: { a: 'é', z: false }, b: 2 });
  assert.equal(one.hash, two.hash);
  const bytes = readFileSync(one.path);
  assert.equal(one.hash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(bytes.toString(), '{"a":1,"b":2,"nested":{"a":"é","z":false}}\n');
  assert.equal(one.uri, 'https://raw.githubusercontent.com/Mule-Protocol/mule/main/data/' + one.hash + '.json');
  assert.ok(Buffer.byteLength(one.uri, 'utf8') <= 200);
  assert.deepEqual(store.read(one.uri, one.hash), { a: 1, b: 2, nested: { a: 'é', z: false } });
  assert.deepEqual(store.read(one.hash), store.read(one.uri));
});
test('every read rehashes bytes and writes cannot silently replace corrupted content', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mule-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalContentStore(directory);
  const content = store.put({ value: 'original' });
  assert.deepEqual(store.read(content.uri), { value: 'original' });
  writeFileSync(content.path, '{"value":"tampered"}\n');
  assert.throws(() => store.read(content.uri), /SHA-256 mismatch/);
  assert.throws(() => store.read(content.hash), /SHA-256 mismatch/);
  assert.throws(() => store.put({ value: 'original' }), /SHA-256 mismatch/);
});
test('content references reject network URLs, traversal and mismatching expected hashes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mule-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalContentStore(directory);
  const content = store.put({ value: 1 });
  for (const reference of ['https://example.com/file.json', '../outside.json', content.uri + '?x=1', content.uri.replace('/main/', '/codex/m1-local-missions/'), 'A'.repeat(64)]) {
    assert.throws(() => store.read(reference), /Unsupported content reference/);
  }
  assert.throws(() => store.read(content.uri, 'b'.repeat(64)), /disagree/);
  assert.throws(() => contentUri('../outside'));
});
test('store rejects invalid JSON even when the file hash is correct', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mule-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = 'not JSON';
  const hash = sha256(bytes);
  writeFileSync(join(directory, hash + '.json'), bytes);
  assert.throws(() => new LocalContentStore(directory).read(hash), SyntaxError);
});
test('canonical encoder rejects silently lossy JSON values', () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, 1n, { field: undefined }, [undefined], new Date(), cyclic, Array(2), { [Symbol('x')]: 1 }]) {
    assert.throws(() => canonicalJson(value));
  }
  assert.equal(canonicalJson([0, false, null, '']), '[0,false,null,""]\n');
});
test('report hashes survive a restart and bind criteria, delivery and mission', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mule-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let store = new LocalContentStore(directory);
  const fixture = loadFixture('invoice.v1');
  const criteria = store.put(fixture.criteria);
  const delivery = store.put(fixture.input);
  const request = { mission: 'mission-1', criteria: fixture.criteria, delivery: fixture.input, criteriaHash: criteria.hash, deliveryHash: delivery.hash };
  const first = store.put(validateDelivery(request));
  store = new LocalContentStore(directory);
  const second = store.put(validateDelivery({
    ...request,
    criteria: store.read(criteria.uri, criteria.hash),
    delivery: store.read(delivery.uri, delivery.hash),
  }));
  assert.equal(first.hash, second.hash);
  const differentMission = store.put(validateDelivery({ ...request, mission: 'mission-2' }));
  assert.notEqual(first.hash, differentMission.hash);
});
