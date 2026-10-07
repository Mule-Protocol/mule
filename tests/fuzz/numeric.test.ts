import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { BN, MuleClient, type Idl } from '../../packages/sdk/src/index.js';
import { decodedI64, decodedU64 } from './numeric.js';

function fromBytes(value: bigint, signed = false): BN {
  const bytes = Buffer.alloc(8);
  if (signed) bytes.writeBigInt64LE(value); else bytes.writeBigUInt64LE(value);
  const result = new BN(bytes, 'le');
  return signed ? result.fromTwos(64) : result;
}

test('invariant integers retain exact bits at the observed decimal-conversion failures and u64/i64 bounds', () => {
  for (const value of [0n, 1n, 67_108_863n, 67_108_864n, 67_108_865n, 97_816_772n, (1n << 53n) + 1n, (1n << 64n) - 1n]) {
    const bn = fromBytes(value);
    bn.toString = () => { throw new Error('Decimal text must not be used'); };
    assert.equal(decodedU64(bn), value);
  }
  for (const value of [-(1n << 63n), -1n, 0n, 67_108_864n, 97_816_772n, (1n << 63n) - 1n]) {
    const bn = fromBytes(value, true);
    bn.toString = () => { throw new Error('Decimal text must not be used'); };
    assert.equal(decodedI64(bn), value);
  }
  assert.throws(() => decodedU64(fromBytes(-1n, true)), RangeError);
  assert.throws(() => decodedU64(new BN('10000000000000000', 16)), RangeError);
  assert.throws(() => decodedI64(fromBytes(1n << 63n)), RangeError);
  assert.throws(() => decodedI64(new BN('-8000000000000001', 16)), RangeError);
});

test('generated account codec and fuzz oracle agree with exact raw u64/i64 bytes', async () => {
  const idl = JSON.parse(readFileSync('target/idl/mule_escrow.json', 'utf8')) as Idl;
  const sdk = new MuleClient(idl);
  const definition = idl.accounts?.find(account => account.name.toLowerCase() === 'config');
  assert(definition);
  const type = idl.types?.find(type => type.name === definition.name);
  assert(type?.type.kind === 'struct' && type.type.fields);
  for (const amount of [67_108_864n, 97_816_772n, (1n << 64n) - 1n]) {
    for (const window of [-(1n << 63n), (1n << 63n) - 1n]) {
      const values: Record<string, unknown> = { admin: PublicKey.default, pendingadmin: null,
        validator: PublicKey.default, mint: PublicKey.default, mindisputewindow: fromBytes(window, true),
        maxamount: fromBytes(amount), paused: false, bump: 0 };
      const fields: Record<string, unknown> = {};
      for (const field of type.type.fields) {
        assert(typeof field === 'object' && 'name' in field);
        fields[field.name] = values[field.name.replaceAll('_', '').toLowerCase()];
      }
      const bytes: Buffer = await sdk.coder.accounts.encode(definition.name, fields);
      // Config: discriminator + admin + pending=None tag + validator + mint.
      const windowOffset = 8 + 32 + 1 + 32 + 32;
      assert.equal(bytes.readBigInt64LE(windowOffset), window);
      assert.equal(bytes.readBigUInt64LE(windowOffset + 8), amount);
      const decoded = sdk.decodeConfig(bytes);
      decoded.maxAmount.toString = () => '7108864';
      decoded.minDisputeWindow.toString = () => 'incorrect';
      assert.equal(decodedU64(decoded.maxAmount), amount);
      assert.equal(decodedI64(decoded.minDisputeWindow), window);
    }
  }
});
