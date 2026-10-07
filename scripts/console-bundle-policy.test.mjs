import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectConsoleBundle } from './console-bundle-policy.mjs';

test('bundle policy parses an autonomous browser module', () => {
  const result = inspectConsoleBundle('export const hash = async value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));');
  assert.equal(result.eval, 0);
  assert.equal(result.imports, 0);
});
test('bundle policy rejects dynamic compilation, hidden member access, dependencies and Node/network APIs', () => {
  for (const source of [
    'eval("1")', 'new Function("return 1")', 'globalThis["eval"]("1")',
    'globalThis["Function"]("return 1")', 'import("remote")', 'import a from "dep"',
    'export {a} from "dep"', 'Buffer.from("x")', 'process.env.X',
    'fetch("https://example.invalid")', 'new WebSocket("wss://example.invalid")',
  ]) assert.throws(() => inspectConsoleBundle(source), undefined, source);
});
