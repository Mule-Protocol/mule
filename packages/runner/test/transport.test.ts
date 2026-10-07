import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Keypair, SendTransactionError, SystemProgram, type Connection } from '@solana/web3.js';
import { Journal } from '../src/journal.js';
import { RpcRunner, type LocalKeys, type TransactionRecord } from '../src/rpc.js';
import { TestFault } from '../src/faults.js';

function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'mule-transport-'));
  const admin=Keypair.generate(),recipient=Keypair.generate().publicKey;
  let submitted=false, sends=0, builds=0, lostResponse=false;
  let rejectPreflight=false;
  const sent:Buffer[]=[];
  const connection={
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),
    getSignatureStatuses:async()=>({value:[submitted?{err:null,confirmationStatus:'confirmed'}:null]}),
    getBlockHeight:async()=>1,
    sendRawTransaction:async(bytes:Buffer)=>{
      sends++;sent.push(bytes);
      if(rejectPreflight)throw new SendTransactionError({action:'simulate',signature:'',transactionMessage:'named program rejection',logs:['Program log: named program rejection']});
      submitted=true;
      if(lostResponse)throw new Error('Connection lost after acceptance');
      const record=new Journal(directory).read<TransactionRecord>('tx:mission:record_verdict');
      assert(record);return record.signature;
    },
  } as unknown as Connection;
  const reopen=():RpcRunner=>{
    const runner=Object.create(RpcRunner.prototype) as RpcRunner;
    Object.assign(runner,{connection,journal:new Journal(directory),keys:{admin} as LocalKeys});
    runner.receipt=async(signature:string)=>({signature,events:[]});
    return runner;
  };
  return {
    directory,reopen,
    build:()=>{builds++;return[SystemProgram.transfer({fromPubkey:admin.publicKey,toPubkey:recipient,lamports:1})];},
    counts:()=>({sends,builds}),sent,
    loseResponse:()=>{lostResponse=true;},
    rejectPreflight:()=>{rejectPreflight=true;},
  };
}
test('ambiguous RPC response reconciles original signature without rebuilding or a second broadcast',async()=>{
  const f=fixture();
  try{
    f.loseResponse();
    const first=await f.reopen().transact('mission:record_verdict',f.build,[]);
    const second=await f.reopen().transact('mission:record_verdict',()=>{throw new Error('must not build twice');},[]);
    assert.equal(first.signature,second.signature);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
    const saved=new Journal(f.directory).read<TransactionRecord>('tx:mission:record_verdict');
    assert.equal(saved?.state,'confirmed');
    assert.equal(saved?.bytes,f.sent[0]?.toString('base64'));
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('post-confirmation fault leaves signed journal; fresh process adapter confirms same signature without broadcast',async()=>{
  const f=fixture();
  const oldMode=process.env.MULE_TEST_MODE,oldFault=process.env.MULE_TEST_FAULT;
  try{
    process.env.MULE_TEST_MODE='1';process.env.MULE_TEST_FAULT='after-verdict';
    await assert.rejects(f.reopen().transact('mission:record_verdict',f.build,[]),TestFault);
    const crashed=new Journal(f.directory).read<TransactionRecord>('tx:mission:record_verdict');
    assert.equal(crashed?.state,'signed');assert.equal(crashed?.receipt,undefined);
    delete process.env.MULE_TEST_FAULT;
    const recovered=await f.reopen().transact('mission:record_verdict',()=>{throw new Error('must not rebuild');},[]);
    assert.equal(recovered.signature,crashed?.signature);
    assert.equal(new Journal(f.directory).read<TransactionRecord>('tx:mission:record_verdict')?.state,'confirmed');
    assert.deepEqual(f.counts(),{sends:1,builds:1});
  } finally{
    if(oldMode===undefined)delete process.env.MULE_TEST_MODE;else process.env.MULE_TEST_MODE=oldMode;
    if(oldFault===undefined)delete process.env.MULE_TEST_FAULT;else process.env.MULE_TEST_FAULT=oldFault;
    rmSync(f.directory,{recursive:true,force:true});
  }
});
test('deterministic simulation rejection fails immediately and retains original signed bytes for inspection',async()=>{
  const f=fixture();
  try{
    f.rejectPreflight();
    await assert.rejects(f.reopen().transact('mission:record_verdict',f.build,[]),/named program rejection/);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
    assert.equal(new Journal(f.directory).read<TransactionRecord>('tx:mission:record_verdict')?.state,'signed');
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});
