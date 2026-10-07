import type { BN } from '@coral-xyz/anchor';

/** Decode exact bits; decimal BN formatting is never an invariant oracle. */
export function decodedU64(value: BN): bigint {
  if (value.isNeg() || value.bitLength() > 64) throw new RangeError('Decoded u64 out of range');
  return value.toArrayLike(Buffer, 'le', 8).readBigUInt64LE();
}
export function decodedI64(value: BN): bigint {
  if (value.bitLength() > 64) throw new RangeError('Decoded i64 out of range');
  const magnitude = value.abs().toArrayLike(Buffer, 'le', 8).readBigUInt64LE();
  if (value.isNeg() ? magnitude > (1n << 63n) : magnitude >= (1n << 63n)) {
    throw new RangeError('Decoded i64 out of range');
  }
  return value.toTwos(64).toArrayLike(Buffer, 'le', 8).readBigInt64LE();
}
