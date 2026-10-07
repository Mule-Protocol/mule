#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Keypair } from '@solana/web3.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.includes('--help')) {
  console.log('Usage: pnpm local:missions --rpc-url http://127.0.0.1:8899');
  console.log('Requires the verified Agave 2.3.0 tools; builds SBF/IDL with Anchor 0.32.2 (CI reuses its verified artifact).');
  console.log('Creates ephemeral genesis-funded keys; never calls an airdrop endpoint.');
  process.exit(0);
}
let rpcUrl = process.env.MULE_RPC_URL;
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--rpc-url' || !args[i + 1]) throw new Error('Unknown or incomplete launcher argument');
  rpcUrl = args[++i];
}
if (!rpcUrl) throw new Error('Set MULE_RPC_URL or pass --rpc-url explicitly');
const parsed = new URL(rpcUrl);
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || !['', '/'].includes(parsed.pathname)) {
  throw new Error('The local-only launcher requires an explicit loopback HTTP RPC URL');
}
const rpcPort = Number(parsed.port);
if (!Number.isInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65534) throw new Error('RPC URL needs a port between 1024 and 65534');
// Refuse an occupied endpoint before building or creating any temporary wallets.
// Both JSON-RPC and its adjacent WebSocket port belong to this fresh local node.
for (const port of [rpcPort, rpcPort + 1]) {
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('Local RPC/WebSocket port is already occupied or unavailable: ' + port)));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close((error) => error ? reject(error) : done()));
  });
}
// Agave 2.3.0 unconditionally starts an internal faucet thread. Per the owner's
// clarified local-only scope, its balance and both caps stay zero; no call uses it.
const validatorVersion = execFileSync('solana-test-validator', ['--version'], { encoding: 'utf8' });
if (!/solana-test-validator 2\.3\.0(?:\s|$)/.test(validatorVersion)) throw new Error('Expected verified solana-test-validator 2.3.0');
const binary = resolve(root, 'target/deploy/mule_escrow.so');
const idlPath = resolve(root, 'target/idl/mule_escrow.json');
if (process.env.MULE_REUSE_VERIFIED_BUILD !== '1') {
  const anchorVersion = execFileSync('anchor', ['--version'], { encoding: 'utf8' });
  if (!/anchor-cli 0\.32\.2(?:\s|$)/.test(anchorVersion)) throw new Error('Expected Anchor CLI 0.32.2');
  execFileSync('anchor', ['build', '--no-idl', '--', '--tools-version', 'v1.56'], { cwd: root, stdio: 'inherit' });
  mkdirSync(dirname(idlPath), { recursive: true });
  execFileSync('anchor', ['idl', 'build', '--out', idlPath], { cwd: root, stdio: 'inherit' });
}
if (!existsSync(binary) || !existsSync(idlPath)) throw new Error('Compiled SBF/IDL artifact is missing');
execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
if (!idl.address) throw new Error('Generated IDL has no program identity');
if (readFileSync(idlPath, 'utf8') !== readFileSync(resolve(root, 'idl/mule_escrow.json'), 'utf8')) {
  throw new Error('Built IDL differs from versioned IDL');
}
const work = mkdtempSync(join(tmpdir(), 'mule-local-'));
let logFd;
let validator;
let campaign;
let validatorError;
let interrupted = false;
const stop = () => {
  interrupted = true;
  campaign?.kill('SIGTERM');
  validator?.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  chmodSync(work, 0o700);
  const keyDir = join(work, 'keys');
  mkdirSync(keyDir, { mode: 0o700 });
  const names = ['admin', 'validator', 'client', 'agent', 'mintAuthority', 'upgradeAuthority'];
  const keys = Object.fromEntries(names.map((name) => [name, Keypair.generate()]));
  const accountArgs = [];
  for (const name of names) {
    const key = keys[name];
    writeFileSync(join(keyDir, name + '.json'), JSON.stringify(Array.from(key.secretKey)), { mode: 0o600 });
    const funded = join(work, name + '-genesis.json');
    writeFileSync(funded, JSON.stringify({
      pubkey: key.publicKey.toBase58(),
      account: { lamports: 100_000_000_000, data: ['', 'base64'], owner: '11111111111111111111111111111111', executable: false, rentEpoch: 0, space: 0 },
    }), { mode: 0o600 });
    accountArgs.push('--account', key.publicKey.toBase58(), funded);
  }
  const configPath = join(work, 'solana-cli.yml');
  writeFileSync(configPath, [
    'json_rpc_url: ' + rpcUrl,
    'websocket_url: ""',
    'keypair_path: ' + JSON.stringify(join(keyDir, 'admin.json')),
    'address_labels: {}',
    'commitment: confirmed',
    '',
  ].join('\n'), { mode: 0o600 });
  const logPath = join(work, 'validator.log');
  logFd = openSync(logPath, 'w', 0o600);
  const validatorArgs = [
    '--config', configPath, '--ledger', join(work, 'ledger'),
    '--reset', '--quiet', '--bind-address', '127.0.0.1', '--rpc-port', String(rpcPort),
    '--mint', Keypair.generate().publicKey.toBase58(),
    '--faucet-port', '0', '--faucet-sol', '0',
    '--faucet-per-request-sol-cap', '0', '--faucet-per-time-sol-cap', '0',
    '--upgradeable-program', idl.address, binary, keys.upgradeAuthority.publicKey.toBase58(),
    ...accountArgs,
  ];
  validator = spawn('solana-test-validator', validatorArgs, {
    cwd: root, stdio: ['ignore', logFd, logFd],
    env: { ...process.env, SOLANA_METRICS_CONFIG: '' },
  });
  validator.once('error', (error) => { validatorError = error; });
  const readyDeadline = Date.now() + 120_000;
  let ready = false;
  while (!ready && Date.now() < readyDeadline && !interrupted) {
    if (validatorError) throw validatorError;
    if (validator.exitCode !== null) throw new Error('Local validator exited before readiness; exit ' + validator.exitCode);
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: AbortSignal.timeout(1500),
      });
      ready = response.ok && (await response.json()).result === 'ok';
    } catch { /* Bounded readiness polling while the local genesis starts. */ }
    if (!ready) await delay(500);
  }
  if (!ready) throw new Error(interrupted ? 'Local run interrupted' : 'Local validator did not become ready in 120 seconds');
  const stateDir = join(work, 'state');
  mkdirSync(stateDir, { mode: 0o700 });
  const runnerEnv = {
    ...process.env,
    MULE_RPC_URL: rpcUrl,
    MULE_KEY_DIR: keyDir,
    MULE_STATE_DIR: stateDir,
    MULE_DATA_DIR: resolve(root, 'data'),
    MULE_RUN_DIR: resolve(root, 'runs'),
    MULE_RUN_ID: process.env.MULE_RUN_ID || Date.now().toString(),
    MULE_IDL_PATH: idlPath,
  };
  const code = await new Promise((resolveExit, reject) => {
    campaign = spawn(process.execPath, ['--import', 'tsx', 'packages/runner/src/cli.ts', 'campaign'], {
      cwd: root, stdio: 'inherit', env: runnerEnv,
    });
    campaign.once('error', reject);
    campaign.once('exit', (exitCode, signal) => signal
      ? reject(new Error('Campaign interrupted: ' + signal))
      : resolveExit(exitCode ?? 1));
  });
  if (code !== 0) throw new Error('Local campaign failed with exit code ' + code);
} finally {
  campaign?.kill('SIGTERM');
  validator?.kill('SIGTERM');
  if (validator && validator.exitCode === null) {
    await Promise.race([new Promise((done) => validator.once('exit', done)), delay(5000)]);
    if (validator.exitCode === null) validator.kill('SIGKILL');
  }
  if (logFd !== undefined) closeSync(logFd);
  // Only the known mkdtemp directory is removed. Public data/reports remain.
  rmSync(work, { recursive: true, force: true });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
