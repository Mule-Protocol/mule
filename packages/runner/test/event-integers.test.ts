import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BN } from '@mule/sdk';
import { RpcRunner } from '../src/rpc.js';

test('RPC event evidence serializes exact signed/unsigned integers without BN decimal conversion',async()=>{
  const data={amount:new BN('97816772'),wordBoundary:new BN('67108864'),
    signedMin:new BN('-8000000000000000',16),signedMax:new BN('7fffffffffffffff',16),
    unsignedMax:new BN('ffffffffffffffff',16)};
  const runner=Object.create(RpcRunner.prototype) as RpcRunner;
  Object.assign(runner,{
    connection:{getTransaction:async()=>({meta:{err:null,logMessages:[]}})},
    sdk:{events:()=>[{name:'ExactIntegers',data}]},
  });
  const original=BN.prototype.toString;
  BN.prototype.toString=():string=>{throw new Error('BN decimal rendering must not create public evidence');};
  try {
    const receipt=await runner.receipt('test-signature');
    assert.deepEqual(receipt.events[0]?.data,{amount:'97816772',wordBoundary:'67108864',
      signedMin:'-9223372036854775808',signedMax:'9223372036854775807',unsignedMax:'18446744073709551615'});
  } finally {BN.prototype.toString=original;}
});
