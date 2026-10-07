import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BN, bnToBigInt } from '../src/index.js';

const values=[0n,1n,-1n,97_816_772n,-97_816_772n,67_108_864n,-67_108_864n,
  -(1n<<63n),(1n<<63n)-1n,(1n<<64n)-1n];
const make=(value:bigint):BN=>new BN(value.toString(16),16);

test('BN byte conversion preserves word boundaries and the full signed/unsigned 64-bit domains',()=>{
  for(const expected of values) {
    const input=make(expected);
    const before=input.abs().toArrayLike(Buffer,'le');
    const negative=input.isNeg();
    assert.equal(bnToBigInt(input),expected);
    assert.deepEqual(input.abs().toArrayLike(Buffer,'le'),before,'Input magnitude must not be mutated');
    assert.equal(input.isNeg(),negative,'Input sign must not be mutated');
  }
});
test('BN byte conversion never calls toString, including through a cloned magnitude',()=>{
  const inputs=values.map(make);
  const original=BN.prototype.toString;
  BN.prototype.toString=():string=>{throw new Error('BN.toString is forbidden in exact integer conversion');};
  try {
    for(const [index,input] of inputs.entries())assert.equal(bnToBigInt(input),values[index]);
  } finally {BN.prototype.toString=original;}
});
