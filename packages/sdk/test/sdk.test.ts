import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { MuleClient, InMemoryMissionIdHistory, PROGRAM_ID, BN, DISPUTE_TIMEOUT, missionStatus,
  configPda, missionPda, vaultPda, u64le, type Idl, type InstructionName } from '../src/index.js';

const idl=JSON.parse(readFileSync('target/idl/mule_escrow.json','utf8')) as Idl;
const sdk=new MuleClient(idl);
const client=new PublicKey('11111111111111111111111111111112');
const other=new PublicKey('11111111111111111111111111111113');
const testSdk=()=>new MuleClient(idl,PROGRAM_ID,new InMemoryMissionIdHistory());
function createArgs() {
  return {mission_id:1n,amount:1n,criteria_hash:Array<number>(32).fill(0),criteria_uri:'x',
    deadline:20n,dispute_window:60n,designated_agent:null};
}
function createAccounts() {
  const def=idl.instructions.find(i=>i.name.replaceAll('_','').toLowerCase()==='createmission');assert(def);
  return Object.fromEntries(def.accounts.map(a=>[a.name,client]));
}
async function encodeAccount(name:string,values:Record<string,unknown>) {
  const def=idl.accounts?.find(a=>a.name.toLowerCase()===name);assert(def);
  const type=idl.types?.find(t=>t.name===def.name);assert(type && type.type.kind==='struct');
  const fields=type.type.fields;assert(fields);
  const data:Record<string,unknown>={};
  for(const field of fields){
    assert(typeof field==='object'&&'name' in field);
    const value=values[field.name.replaceAll('_','').toLowerCase()];
    assert.notEqual(value,undefined,'missing account fixture field: '+field.name);
    data[field.name]=value;
  }
  return sdk.coder.accounts.encode(def.name,data);
}
test('PDA seeds use the full u64 little-endian domain without JavaScript rounding',()=>{
  assert.equal(u64le(0x0102030405060708n).toString('hex'),'0807060504030201');
  const first=missionPda(client,9_007_199_254_740_992n)[0];
  const next=missionPda(client,9_007_199_254_740_993n)[0];assert(!first.equals(next));
  assert(!PublicKey.isOnCurve(configPda()[0].toBytes()));
  assert(!PublicKey.isOnCurve(first.toBytes()));assert(!PublicKey.isOnCurve(vaultPda(first)[0].toBytes()));
  assert(!missionPda(SystemProgram.programId,1n)[0].equals(missionPda(client,1n)[0]));
  assert.throws(()=>u64le(-1n),RangeError);assert.throws(()=>u64le(1n<<64n),RangeError);
});
test('all 15 instructions encode the generated discriminator and exact signer/write metadata',()=>{
  assert.equal(idl.instructions.length,15);
  const builder=testSdk();
  for(const def of idl.instructions){
    const accounts:Record<string,PublicKey>={};
    for(const account of def.accounts){assert('name' in account);accounts[account.name]=client;}
    const args:Record<string,unknown>={};
    for(const arg of def.args){
      args[arg.name]=arg.type==='pubkey'?client:arg.type==='bool'?true:arg.type==='string'?'uri'
        :arg.type==='u64'||arg.type==='i64'?1n
          :typeof arg.type==='object'&&'option' in arg.type?null:Array<number>(32).fill(3);
    }
    const name=def.name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()) as InstructionName;
    const ix=builder.instruction(name,accounts,args);
    assert(ix.programId.equals(PROGRAM_ID));
    assert.deepEqual(ix.data.subarray(0,8),createHash('sha256').update('global:'+name).digest().subarray(0,8));
    assert.deepEqual(ix.keys.map(k=>[k.isSigner,k.isWritable]),def.accounts.map(a=>{
      assert(!('accounts' in a));return [a.signer===true,a.writable===true];
    }));
  }
});
test('SDK rejects missing accounts, missing args, wrong IDL address and unsafe numeric amounts',()=>{
  assert.throws(()=>new MuleClient({...idl,address:SystemProgram.programId.toBase58()}),/address mismatch/);
  assert.throws(()=>sdk.instruction('accept_mission',{}),/Missing account/);
  const builder=testSdk(),accounts=createAccounts(),args=createArgs();
  assert.throws(()=>builder.instruction('create_mission',accounts,{}),/Missing argument/);
  assert.throws(()=>builder.instruction('create_mission',accounts,{...args,amount:Number.MAX_SAFE_INTEGER}),/require bigint/);
  assert.throws(()=>builder.instruction('create_mission',accounts,{...args,amount:-1n}),/out of range/);
  assert.throws(()=>builder.instruction('create_mission',accounts,{...args,deadline:1n<<63n}),/out of range/);
  // Rejected encodings must not consume the ID.
  assert(builder.instruction('create_mission',accounts,args));
});
test('config decoder checks discriminator, pending admin and preserves all 64-bit values',async()=>{
  for(const pending of [null,other]){
    const encoded=await encodeAccount('config',{admin:client,pendingadmin:pending,validator:client,mint:client,
      mindisputewindow:new BN('3600'),maxamount:new BN('18446744073709551615'),paused:true,bump:255});
    const decoded=sdk.decodeConfig(encoded);assert.equal(decoded.maxAmount.toString(),'18446744073709551615');
    assert.equal(decoded.paused,true);assert(decoded.admin.equals(client));
    assert.equal(decoded.pendingAdmin?.toBase58()??null,pending?.toBase58()??null);
    const corrupt=Buffer.from(encoded);corrupt[0]=(corrupt[0]??0)^255;
    assert.throws(()=>sdk.decodeConfig(corrupt),/discriminator/i);
    assert.throws(()=>sdk.decodeMission(encoded),/discriminator/i);
  }
});
test('mission decoder preserves designation, dispute timestamp and both original verdicts',async()=>{
  assert.equal(DISPUTE_TIMEOUT,14n*24n*60n*60n);
  for(const verdict of [null,true,false]){
    const encoded=await encodeAccount('mission',{client,agent:other,designatedagent:verdict===null?null:other,
      missionid:new BN(5),amount:new BN(100),criteriahash:Array<number>(32).fill(0),criteriauri:'criteria',
      deliveryhash:null,deliveryuri:null,reporthash:null,deadline:new BN(1000),disputewindow:new BN(3600),
      verdictat:verdict===null?null:new BN(500),disputedat:verdict===null?null:new BN('9223372036854775807'),
      originalverdict:verdict,status:{Disputed:{}},bump:254,vaultbump:255});
    const decoded=sdk.decodeMission(encoded);
    assert.equal(decoded.designatedAgent?.toBase58()??null,verdict===null?null:other.toBase58());
    assert.equal(decoded.disputedAt?.toString()??null,verdict===null?null:'9223372036854775807');
    assert.equal(decoded.originalVerdict,verdict);assert.equal(missionStatus(decoded),'disputed');
  }
});
test('designated agent encodes explicit None and Some without shifting existing create arguments',()=>{
  const accounts=createAccounts(),args=createArgs();
  const none=testSdk().instruction('create_mission',accounts,args);
  const some=testSdk().instruction('create_mission',accounts,{...args,designated_agent:other});
  assert.equal(none.data.at(-1),0);
  assert.equal(some.data.length,none.data.length+32);
  assert.equal(some.data.at(-33),1);
  assert.deepEqual(some.data.subarray(-32),other.toBuffer());
  assert.deepEqual(some.data.subarray(0,-33),none.data.subarray(0,-1));
});
test('event decoder ignores lookalike data emitted outside this program',()=>{
  const foreign=SystemProgram.programId.toBase58();
  assert.deepEqual(sdk.events(['Program '+foreign+' invoke [1]','Program data: AAAAAAAAAAA=','Program '+foreign+' success'], null),[]);
});
test('event decoding requires a successful transaction result',()=>{
  const def=idl.events?.find(e=>e.name.replaceAll('_','').toLowerCase()==='missioncancelled');assert(def);
  const bytes=Buffer.concat([Buffer.from(def.discriminator),client.toBuffer(),u64le(5n),Buffer.from([8])]);
  const logs=['Program '+PROGRAM_ID.toBase58()+' invoke [1]','Program data: '+bytes.toString('base64'),
    'Program '+PROGRAM_ID.toBase58()+' success'];
  assert.equal(sdk.events(logs,null).length,1);
  assert.deepEqual(sdk.events(logs,{InstructionError:[1,'Custom']}),[]);
  assert.deepEqual(sdk.events(logs,undefined),[]);
});
test('64-bit endpoint values preserve their exact wire bytes for bigint and BN callers',()=>{
  const accounts=createAccounts();
  for(const asBN of [false,true]){
    const builder=testSdk();
    const integer=(value:bigint)=>asBN?new BN(value.toString(16),16):value;
    const args={mission_id:integer((1n<<64n)-1n),amount:integer((1n<<64n)-1n),
      criteria_hash:Array<number>(32).fill(0),criteria_uri:'x',deadline:integer((1n<<63n)-1n),
      dispute_window:integer(-(1n<<63n)),designated_agent:null};
    const ix=builder.instruction('create_mission',accounts,args);
    assert.equal(ix.data.readBigUInt64LE(8),(1n<<64n)-1n);
    assert.equal(ix.data.readBigUInt64LE(16),(1n<<64n)-1n);
    assert.equal(ix.data.readBigInt64LE(ix.data.length-17),(1n<<63n)-1n);
    assert.equal(ix.data.readBigInt64LE(ix.data.length-9),-(1n<<63n));
    assert.throws(()=>builder.instruction('create_mission',accounts,{...args,amount:integer(1n<<64n)}),/out of range/);
    assert.throws(()=>builder.instruction('create_mission',accounts,{...args,deadline:integer(-(1n<<63n)-1n)}),/out of range/);
  }
});

test('acceptance includes the canonical read-only Config and rejects the legacy account list',()=>{
  const mission=missionPda(client,1n)[0];
  assert.throws(()=>sdk.instruction('accept_mission',{actor:other,mission}),/Missing account: config/);
  const ix=sdk.acceptMissionInstruction(other,mission);
  assert.equal(ix.keys.length,3);
  assert(ix.keys[1]?.pubkey.equals(configPda()[0]));
  assert.equal(ix.keys[1]?.isWritable,false);assert.equal(ix.keys[1]?.isSigner,false);
  assert(ix.keys[0]?.pubkey.equals(other));assert.equal(ix.keys[0]?.isSigner,true);
});
