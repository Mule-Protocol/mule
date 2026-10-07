import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { MuleClient, PROGRAM_ID, BN, configPda, missionPda, vaultPda, u64le, type Idl, type InstructionName } from '../src/index.js';

const idl=JSON.parse(readFileSync('target/idl/mule_escrow.json','utf8')) as Idl;
const sdk=new MuleClient(idl);
const client=new PublicKey('11111111111111111111111111111112');
test('PDA seeds use the full u64 little-endian domain without JavaScript rounding',()=>{
  assert.equal(u64le(0x0102030405060708n).toString('hex'),'0807060504030201');
  const first=missionPda(client,9_007_199_254_740_992n)[0];
  const next=missionPda(client,9_007_199_254_740_993n)[0];assert(!first.equals(next));
  assert(!PublicKey.isOnCurve(configPda()[0].toBytes()));
  assert(!PublicKey.isOnCurve(first.toBytes()));assert(!PublicKey.isOnCurve(vaultPda(first)[0].toBytes()));
  assert(!missionPda(SystemProgram.programId,1n)[0].equals(missionPda(client,1n)[0]));
  assert.throws(()=>u64le(-1n),RangeError);assert.throws(()=>u64le(1n<<64n),RangeError);
});
test('every instruction encodes the generated discriminator and exact signer/write metadata',()=>{
  assert.equal(idl.instructions.length,12);
  for(const def of idl.instructions){
    const accounts:Record<string,PublicKey>={};
    for(const account of def.accounts){assert('name' in account);accounts[account.name]=client;}
    const args:Record<string,unknown>={};
    for(const arg of def.args){
      args[arg.name]=arg.type==='pubkey'?client:arg.type==='bool'?true:arg.type==='string'?'uri'
        :arg.type==='u64'||arg.type==='i64'?1n:Array<number>(32).fill(3);
    }
    const name=def.name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()) as InstructionName;
    const ix=sdk.instruction(name,accounts,args);
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
  const def=idl.instructions.find(i=>i.name.replaceAll('_','').toLowerCase()==='createmission');assert(def);
  const accounts=Object.fromEntries(def.accounts.map(a=>[a.name,client]));
  const args={mission_id:1n,amount:1n,criteria_hash:Array<number>(32).fill(0),criteria_uri:'x',deadline:20n,dispute_window:60n};
  assert.throws(()=>sdk.instruction('create_mission',accounts,{}),/Missing argument/);
  assert.throws(()=>sdk.instruction('create_mission',accounts,{...args,amount:Number.MAX_SAFE_INTEGER}),/require bigint/);
  assert.throws(()=>sdk.instruction('create_mission',accounts,{...args,amount:-1n}),/out of range/);
  assert.throws(()=>sdk.instruction('create_mission',accounts,{...args,deadline:1n<<63n}),/out of range/);
});
test('account decoder checks discriminator and preserves all 64-bit values',async()=>{
  const def=idl.accounts?.find(a=>a.name.toLowerCase()==='config');assert(def);
  const type=idl.types?.find(t=>t.name===def.name);assert(type && type.type.kind==='struct');
  const data:Record<string,unknown>={};
  const values:Record<string,unknown>={admin:client,validator:client,mint:client,mindisputewindow:new BN('3600'),
    maxamount:new BN('18446744073709551615'),paused:true,bump:255};
  const fields=type.type.fields;assert(fields);
  for(const field of fields){assert(typeof field==='object'&&'name' in field);data[field.name]=values[field.name.replaceAll('_','').toLowerCase()];}
  const encoded=await sdk.coder.accounts.encode(def.name,data);
  const decoded=sdk.decodeConfig(encoded);assert.equal(decoded.maxAmount.toString(),'18446744073709551615');
  assert.equal(decoded.paused,true);assert(decoded.admin.equals(client));
  const corrupt=Buffer.from(encoded);corrupt[0]=(corrupt[0]??0)^255;
  assert.throws(()=>sdk.decodeConfig(corrupt),/discriminator/i);
  assert.throws(()=>sdk.decodeMission(encoded),/discriminator/i);
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
  const def=idl.instructions.find(i=>i.name.replaceAll('_','').toLowerCase()==='createmission');assert(def);
  const accounts=Object.fromEntries(def.accounts.map(a=>[a.name,client]));
  for(const asBN of [false,true]){
    const integer=(value:bigint)=>asBN?new BN(value.toString(16),16):value;
    const args={mission_id:integer((1n<<64n)-1n),amount:integer((1n<<64n)-1n),
      criteria_hash:Array<number>(32).fill(0),criteria_uri:'x',deadline:integer((1n<<63n)-1n),
      dispute_window:integer(-(1n<<63n))};
    const ix=sdk.instruction('create_mission',accounts,args);
    assert.equal(ix.data.readBigUInt64LE(8),(1n<<64n)-1n);
    assert.equal(ix.data.readBigUInt64LE(16),(1n<<64n)-1n);
    assert.equal(ix.data.readBigInt64LE(ix.data.length-16),(1n<<63n)-1n);
    assert.equal(ix.data.readBigInt64LE(ix.data.length-8),-(1n<<63n));
    assert.throws(()=>sdk.instruction('create_mission',accounts,{...args,amount:integer(1n<<64n)}),/out of range/);
    assert.throws(()=>sdk.instruction('create_mission',accounts,{...args,deadline:integer(-(1n<<63n)-1n)}),/out of range/);
  }
});