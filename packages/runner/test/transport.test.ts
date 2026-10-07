import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import bs58 from 'bs58';
import { Keypair, SendTransactionError, SystemProgram, Transaction, type Connection } from '@solana/web3.js';
import { Journal } from '../src/journal.js';
import { RpcRunner, CreationExpiredWithoutExecution, type LocalKeys, type TransactionRecord } from '../src/rpc.js';
import { TestFault } from '../src/faults.js';

function fixture(instruction='record_verdict') {
  const directory=mkdtempSync(join(tmpdir(),'mule-transport-'));
  const admin=Keypair.generate(),recipient=Keypair.generate().publicKey;
  const operation=recipient.toBase58()+':'+instruction;
  let sends=0,builds=0,lostResponse=false,rejectPreflight=false,dropFirst=false,advance=false,height=0,lookups=0;
  const landed=new Set<string>();
  const sent:Buffer[]=[];
  const connection={
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:height+(advance?2:100)}),
    getSlot:async()=>0,
    getFirstAvailableBlock:async()=>0,
    getTransaction:async()=>{lookups++;return null;},
    getAccountInfo:async()=>null,
    getSignaturesForAddress:async()=>[],
    getSignatureStatuses:async(signatures:string[])=>({value:signatures.map(signature=>landed.has(signature)?{err:null,confirmationStatus:'confirmed'}:null)}),
    getBlockHeight:async()=>{if(advance)height++;return height;},
    sendRawTransaction:async(bytes:Buffer)=>{
      sends++;sent.push(bytes);
      if(rejectPreflight)throw new SendTransactionError({action:'simulate',signature:'',transactionMessage:'named program rejection',logs:['Program log: named program rejection']});
      const transaction=Transaction.from(bytes);assert(transaction.signature);
      const signature=bs58.encode(transaction.signature);
      if(dropFirst&&sends===1)throw new Error('Request lost before acceptance');
      landed.add(signature);
      if(lostResponse)throw new Error('Connection lost after acceptance');
      return signature;
    },
  } as unknown as Connection;
  const reopen=():RpcRunner=>{
    const runner=Object.create(RpcRunner.prototype) as RpcRunner;
    Object.assign(runner,{connection,journal:new Journal(directory),keys:{admin} as LocalKeys});
    runner.receipt=async(signature:string)=>({signature,events:[]});
    return runner;
  };
  return {directory,operation,reopen,
    build:()=>{builds++;return[SystemProgram.transfer({fromPubkey:admin.publicKey,toPubkey:recipient,lamports:1})];},
    counts:()=>({sends,builds}),sent,lookups:()=>lookups,
    loseResponse:()=>{lostResponse=true;},rejectPreflight:()=>{rejectPreflight=true;},
    dropUntilExpiry:()=>{dropFirst=true;advance=true;},
  };
}
test('ambiguous RPC response reconciles original signature without rebuilding or a second broadcast',async()=>{
  const f=fixture();
  try{
    f.loseResponse();
    const first=await f.reopen().transact(f.operation,f.build,[]);
    const second=await f.reopen().transact(f.operation,()=>{throw new Error('must not build twice');},[]);
    assert.equal(first.signature,second.signature);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
    const saved=new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation);
    assert.equal(saved?.state,'confirmed');assert.equal(saved?.broadcastAttempted,true);
    assert.equal(saved?.bytes,f.sent[0]?.toString('base64'));
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('post-confirmation fault leaves signed journal; restart confirms same signature without broadcast',async()=>{
  const f=fixture();const oldMode=process.env.MULE_TEST_MODE,oldFault=process.env.MULE_TEST_FAULT;
  try{
    process.env.MULE_TEST_MODE='1';process.env.MULE_TEST_FAULT='after-verdict';
    await assert.rejects(f.reopen().transact(f.operation,f.build,[]),TestFault);
    const crashed=new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation);
    assert.equal(crashed?.state,'signed');assert.equal(crashed?.receipt,undefined);
    delete process.env.MULE_TEST_FAULT;
    const recovered=await f.reopen().transact(f.operation,()=>{throw new Error('must not rebuild');},[]);
    assert.equal(recovered.signature,crashed?.signature);
    assert.equal(new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation)?.state,'confirmed');
    assert.deepEqual(f.counts(),{sends:1,builds:1});
  } finally{
    if(oldMode===undefined)delete process.env.MULE_TEST_MODE;else process.env.MULE_TEST_MODE=oldMode;
    if(oldFault===undefined)delete process.env.MULE_TEST_FAULT;else process.env.MULE_TEST_FAULT=oldFault;
    rmSync(f.directory,{recursive:true,force:true});
  }
});
test('deterministic simulation rejection fails immediately and retains signed bytes',async()=>{
  const f=fixture();
  try{
    f.rejectPreflight();
    await assert.rejects(f.reopen().transact(f.operation,f.build,[]),/named program rejection/);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
    assert.equal(new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation)?.state,'signed');
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('unknown non-execution waits for finalized expiry, reconciles history, then signs retained instructions once',async()=>{
  const f=fixture();
  try{
    f.dropUntilExpiry();
    const receipt=await f.reopen().transact(f.operation,f.build,[]);
    assert.deepEqual(f.counts(),{sends:2,builds:1});
    assert.equal(f.lookups(),1);
    const record=new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation);assert(record);
    assert.equal(record.expiredAttempts?.length,1);
    const expired=record.expiredAttempts[0]!;
    assert(expired.finalizedHeight>expired.lastValidBlockHeight);
    assert.equal(expired.outcome,'expired-not-landed');
    assert.notEqual(expired.signature,receipt.signature);
    assert.notDeepEqual(f.sent[0],f.sent[1],'New blockhash requires a distinct signature');
    const first=Transaction.from(f.sent[0]!),second=Transaction.from(f.sent[1]!);
    assert.deepEqual(first.instructions[0]?.data,second.instructions[0]?.data,'Reservation/instruction is not rebuilt');
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});
test('pruned RPC history never authorizes replacement of an uncertain transaction',async()=>{
  const f=fixture();
  try{
    f.dropUntilExpiry();
    const runner=f.reopen();runner.connection.getFirstAvailableBlock=async()=>100;
    await assert.rejects(runner.transact(f.operation,f.build,[]),/pruned required history/);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
  } finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('expired creation is never re-signed and keeps a durable non-execution proof for a new identity',async()=>{
  const f=fixture('create_mission');
  try {
    f.dropUntilExpiry();
    await assert.rejects(f.reopen().transact(f.operation,f.build,[]),CreationExpiredWithoutExecution);
    const record=new Journal(f.directory).read<TransactionRecord>('tx:'+f.operation);assert(record);
    assert.equal(record.state,'expired-not-landed');
    const proof=record.expiredAttempts?.at(-1);assert(proof);
    assert(proof.finalizedHeight>proof.lastValidBlockHeight);
    assert.equal(proof.signature,record.signature);
    assert.deepEqual(f.counts(),{sends:1,builds:1},'No replacement bytes or blind retry of stale creation');
    await assert.rejects(f.reopen().transact(f.operation,()=>{throw new Error('Consumed creation cannot be rebuilt');},[]),CreationExpiredWithoutExecution);
    assert.deepEqual(f.counts(),{sends:1,builds:1});
  } finally {rmSync(f.directory,{recursive:true,force:true});}
});
