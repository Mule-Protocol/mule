import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { BN, DISPUTE_TIMEOUT, STALE_SECONDS, type Mission } from '@mule/sdk';
import { sweep, type SweepPort, type SweepInstruction } from '../src/sweep.js';

const address = Keypair.generate().publicKey;
function fixture(state:string,time:bigint) {
  const mission = {status:{[state]:{}},deadline:new BN('100'),verdictAt:new BN('110'),
    disputeWindow:new BN('60'),disputedAt:new BN('120'),originalVerdict:true} as Mission;
  const calls:SweepInstruction[]=[];
  const port:SweepPort={now:async()=>time,mission:async()=>mission,
    execute:async(_address:PublicKey,instruction:SweepInstruction)=>{calls.push(instruction);return{signature:'unit-signature',events:[]};}};
  return{mission,calls,port};
}
test('sweep reaches normal verdict boundary exactly and ignores closed or not-yet-due missions',async()=>{
  for(const state of ['passed','failed']) {
    const before=fixture(state,169n);assert.deepEqual(await sweep(before.port,[address]),[]);
    const exact=fixture(state,170n);assert.equal((await sweep(exact.port,[address]))[0]?.instruction,'finalize');
  }
  const closed=fixture('open',100n);closed.port.mission=async()=>null;
  assert.deepEqual(await sweep(closed.port,[address]),[]);
});
test('sweep selects expiry for both Open and Accepted at the exact deadline',async()=>{
  for(const state of ['open','accepted']){
    const before=fixture(state,99n);assert.deepEqual(await sweep(before.port,[address]),[]);
    const exact=fixture(state,100n);assert.equal((await sweep(exact.port,[address]))[0]?.instruction,'refund_expired');
  }
});
test('sweep selects stale refund only for Submitted without a verdict at seven-day boundary',async()=>{
  const before=fixture('submitted',100n+STALE_SECONDS-1n);before.mission.verdictAt=null;
  assert.deepEqual(await sweep(before.port,[address]),[]);
  const exact=fixture('submitted',100n+STALE_SECONDS);exact.mission.verdictAt=null;
  assert.equal((await sweep(exact.port,[address]))[0]?.instruction,'refund_stale');
  const hasVerdict=fixture('submitted',100n+STALE_SECONDS);
  assert.deepEqual(await sweep(hasVerdict.port,[address]),[]);
});
test('sweep chooses disputed finalize at fourteen-day boundary for either original verdict',async()=>{
  for(const originalVerdict of [true,false]){
    const before=fixture('disputed',120n+DISPUTE_TIMEOUT-1n);before.mission.originalVerdict=originalVerdict;
    assert.deepEqual(await sweep(before.port,[address]),[]);
    const exact=fixture('disputed',120n+DISPUTE_TIMEOUT);exact.mission.originalVerdict=originalVerdict;
    assert.equal((await sweep(exact.port,[address]))[0]?.instruction,'finalize');
  }
});

test('sweep reads all chain-time BN values without decimal rendering',async()=>{
  const cases:Array<[string,bigint,'finalize'|'refund_expired'|'refund_stale']>=[
    ['open',100n,'refund_expired'],['submitted',100n+STALE_SECONDS,'refund_stale'],
    ['passed',170n,'finalize'],['disputed',120n+DISPUTE_TIMEOUT,'finalize'],
  ];
  const original=BN.prototype.toString;
  BN.prototype.toString=():string=>{throw new Error('BN.toString must not decide an escrow deadline');};
  try {
    for(const [state,time,instruction] of cases) {
      const example=fixture(state,time);
      if(state==='submitted')example.mission.verdictAt=null;
      assert.equal((await sweep(example.port,[address]))[0]?.instruction,instruction);
    }
  } finally {BN.prototype.toString=original;}
});
