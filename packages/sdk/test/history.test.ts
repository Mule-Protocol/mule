import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { BN, MuleClient, MissionIdAlreadyUsedError, PROGRAM_ID, type Idl } from '../src/index.js';
import { FileMissionIdHistory } from '../src/file-history.js';

const idl=JSON.parse(readFileSync('target/idl/mule_escrow.json','utf8')) as Idl;
const client=new PublicKey('11111111111111111111111111111112');
const other=new PublicKey('11111111111111111111111111111113');
const definition=idl.instructions.find(ix=>ix.name.replaceAll('_','').toLowerCase()==='createmission');
assert(definition);
const accounts=Object.fromEntries(definition.accounts.map(a=>[a.name,client]));
const args={mission_id:123n,amount:100n,criteria_hash:Array<number>(32).fill(0),criteria_uri:'x',
  deadline:10000n,dispute_window:3600n,designated_agent:null};
function historyDirectory(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'mule-sdk-history-'));
  t.after(()=>{
    assert(directory.startsWith(join(tmpdir(),'mule-sdk-history-')));
    rmSync(directory,{recursive:true,force:true});
  });
  return directory;
}
function reserveInChild(directory:string,key:string):Promise<string> {
  const code="const { FileMissionIdHistory }=require(process.argv[1]);"
    +"process.stdout.write(new FileMissionIdHistory(process.argv[2]).reserve(process.argv[3])?'reserved':'duplicate');";
  return new Promise((accept,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','--eval',code,
      resolve('packages/sdk/src/file-history.ts'),directory,key],{windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',(data:string)=>{stdout+=data;});
    child.stderr.setEncoding('utf8');child.stderr.on('data',(data:string)=>{stderr+=data;});
    child.on('error',reject);child.on('close',exit=>{
      if(exit!==0) reject(new Error('History child failed: '+stderr));else accept(stdout);
    });
  });
}
test('create_mission refuses to build without an explicitly shared history',()=>{
  assert.throws(()=>new MuleClient(idl).instruction('create_mission',accounts,args),/requires a shared durable/);
});
test('durable SDK history prevents reuse across instances, including BN aliases and after a cancel instruction',t=>{
  const directory=historyDirectory(t);
  const first=new MuleClient(idl,PROGRAM_ID,new FileMissionIdHistory(directory));
  assert(first.instruction('create_mission',accounts,args));
  const cancel=idl.instructions.find(ix=>ix.name.replaceAll('_','').toLowerCase()==='cancelmission');assert(cancel);
  assert(first.instruction('cancel_mission',Object.fromEntries(cancel.accounts.map(a=>[a.name,client]))));
  // Building a terminal instruction never releases an ID; history is independent
  // of current on-chain account existence and also burns failed/unsubmitted IDs.
  const restarted=new MuleClient(idl,PROGRAM_ID,new FileMissionIdHistory(directory));
  assert.throws(()=>restarted.instruction('create_mission',accounts,{...args,mission_id:new BN(123)}),
    MissionIdAlreadyUsedError);
  assert.throws(()=>first.instruction('create_mission',accounts,args),MissionIdAlreadyUsedError);
  assert.equal(readdirSync(directory).length,1);
});
test('mission history key separates programs, clients and the full u64 ID domain',t=>{
  const directory=historyDirectory(t),history=new FileMissionIdHistory(directory);
  const builder=new MuleClient(idl,PROGRAM_ID,history);
  for(const mission_id of [9_007_199_254_740_992n,9_007_199_254_740_993n,(1n<<64n)-1n]){
    assert(builder.instruction('create_mission',accounts,{...args,mission_id}));
    assert.throws(()=>builder.instruction('create_mission',accounts,{...args,mission_id}),MissionIdAlreadyUsedError);
  }
  assert(builder.instruction('create_mission',{...accounts,client:other},{...args,mission_id:(1n<<64n)-1n}));
  const otherProgram=new MuleClient({...idl,address:other.toBase58()},other,history);
  assert(otherProgram.instruction('create_mission',accounts,{...args,mission_id:(1n<<64n)-1n}));
  assert.equal(readdirSync(directory).length,5);
});
test('durable history arbitrates concurrent processes and survives a process restart',async t=>{
  const directory=historyDirectory(t),key='concurrent-mission';
  const results=await Promise.all([reserveInChild(directory,key),reserveInChild(directory,key)]);
  assert.deepEqual(results.sort(),['duplicate','reserved']);
  assert.equal(await reserveInChild(directory,key),'duplicate');
  assert.equal(readdirSync(directory).length,1);
});
test('empty or corrupt reservation files fail closed after a crash',t=>{
  const directory=historyDirectory(t),history=new FileMissionIdHistory(directory);
  for(const [key,contents] of [['empty',''],['partial','partial\u0000record']] as const){
    const filename=createHash('sha256').update(key).digest('hex')+'.reserved';
    writeFileSync(join(directory,filename),contents);
    assert.equal(history.reserve(key),false);
    assert.equal(readFileSync(join(directory,filename),'utf8'),contents);
  }
});
test('history storage failure prevents an instruction from being returned',()=>{
  const error=new Error('durable storage unavailable');
  const sdk=new MuleClient(idl,PROGRAM_ID,{reserve:()=>{throw error;}});
  assert.throws(()=>sdk.instruction('create_mission',accounts,args),candidate=>candidate===error);
});
