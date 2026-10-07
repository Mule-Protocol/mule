import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { build } from 'esbuild';
import { inspectConsoleBundle } from './console-bundle-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'packages/console-core/dist/console-core.mjs');
const checksum = output + '.sha256';
const check = process.argv.includes('--check');
const notices = ['ajv', 'ajv-formats'].map(name => {
  const license = readFileSync(resolve(root, 'packages/console-core/node_modules', name, 'LICENSE'), 'utf8').replaceAll('\r\n', '\n').trim();
  assert(!license.includes('*/'), 'Unexpected license comment terminator');
  return '/*! Bundled helper: ' + name + '\n' + license + '\n*/';
}).join('\n');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['packages/console-core/src/index.ts'],
  outfile: output, bundle: true, write: false, metafile: true,
  platform: 'browser', format: 'esm', target: 'es2022',
  minify: true, charset: 'utf8', legalComments: 'inline',
  banner: { js: '// MULE console-core — browser-only model; no network, wallet or real funds.\n// MULE source: Apache-2.0; see repository LICENSE.\n' + notices },
});
assert.equal(result.outputFiles.length, 1, 'A single autonomous ES module is required');
const bytes = result.outputFiles[0].contents;
const sha256 = createHash('sha256').update(bytes).digest('hex');
const checksumText = sha256 + '  console-core.mjs\n';
const gzipBytes = gzipSync(bytes, { level: 9 }).length;
assert(gzipBytes <= 40_000, 'Bundle exceeds the 40,000 byte gzip budget: ' + gzipBytes);
const policy = inspectConsoleBundle(new TextDecoder().decode(bytes));
const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/')).sort();
assert(inputs.every(path => !/(?:^|\/)(?:sdk|runner)\//.test(path)), 'No chain or runner code may reach the browser bundle');
if (check) {
  assert.deepEqual(readFileSync(output), Buffer.from(bytes), 'Committed console bundle differs from a clean rebuild');
  assert.equal(readFileSync(checksum, 'utf8'), checksumText, 'Committed bundle checksum differs');
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  writeFileSync(checksum, checksumText);
}
const evidence = {
  schemaVersion: 1, artifact: 'packages/console-core/dist/console-core.mjs',
  bundler: 'esbuild 0.25.12', sha256, rawBytes: bytes.length, gzipBytes,
  gzipLevel: 9, gzipBudgetBytes: 40_000, reconstruction: check ? 'byte-identical' : 'built',
  policy, inputs,
};
mkdirSync(resolve(root, 'coverage'), { recursive: true });
writeFileSync(resolve(root, 'coverage/console-bundle.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
