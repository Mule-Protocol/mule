import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { missionPda } from '@mule/sdk';
import { Journal } from '../src/journal.js';
import { createMission, settleMission, type CampaignReport, type Evidence } from '../src/campaign.js';
import { CreationExpiredWithoutExecution, type RpcRunner } from '../src/rpc.js';
import { type Receipt } from '../src/sweep.js';

function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'mule-recovery-'));
  const client=Keypair.generate(),agent=Keypair.generate();
  const missions:Evidence[]=Array.from({length:10},(_,index)=>({
    number:index+1,missionId:String(index+1),model:'contract.v1',mode:'dishonest',designated:false,dispute:false,
    address:missionPda(client.publicKey,BigInt(index+1))[0].toBase58(),amount:'5',
    criteriaHash:'0'.repeat(64),criteriaUri:'https://raw.githubusercontent.com/Mule-Protocol/mule/main/data/'+'0'.repeat(64)+'.json',
    deadline:'0',transactions:[],
  }));
  const report:CampaignReport={execution:'solana-test-validator',agent:'agent de référence scripté',runId:'unit',date:'2026-10-07',
    genesis:'unit',mint:Keypair.generate().publicKey.toBase58(),program:Keypair.generate().publicKey.toBase58(),
    minDisputeWindow:60,missions,roles:{},setup:[],simulatedOnly:[],checks:{total:10,paid:4,refunded:6,dishonestRefunded:3}};
  return{directory,client,agent,report,journal:new Journal(directory)};
}

test('reserved identity without signed transaction is consumed forever and automatically replaced by a fresh PDA',async()=>{
  const f=fixture();
  try {
    const reserved=new Set(['3']);let created=false,creationId='';const observed:string[]=[];
    const row=f.report.missions[2]!,oldAddress=row.address;
    const runner={
      journal:f.journal,keys:{client:f.client,agent:f.agent},
      isReserved:(id:bigint)=>reserved.has(id.toString()),
      now:async()=>100n,
      missionHistory:async(address:PublicKey)=>{observed.push(address.toBase58());return[];},
      connection:{getAccountInfo:async()=>null,getMultipleAccountsInfo:async()=>[{lamports:20},{lamports:22}]},
      balances:async()=>({client:created?'15':'20',agent:'0',clientLamports:created?'958':'1000'}),
      instruction:async(operation:string,_name:string,_address:PublicKey,_signer:Keypair,args:{mission_id:bigint})=>{
        creationId=args.mission_id.toString();assert.equal(creationId,'11');assert(!reserved.has(creationId));
        reserved.add(creationId);created=true;
        const receipt={signature:'created-once',events:[]};
        f.journal.write('tx:'+operation,{operation,signature:receipt.signature,state:'confirmed',receipt});
        return receipt;
      },
    } as unknown as RpcRunner;
    await createMission(runner,f.report,row);
    assert.equal(creationId,'11');assert(reserved.has('3'));assert(reserved.has('11'));
    assert.deepEqual(observed,[oldAddress]);
    assert.equal(row.missionId,'11');
    assert.equal(row.address,missionPda(f.client.publicKey,11n)[0].toBase58());
    assert.deepEqual(row.consumedIds,[{id:'3',address:oldAddress,status:'consumed-never-created',signatureCount:0}]);
    assert.equal(f.journal.read<{status:string}>('creation:'+oldAddress)?.status,'consumed-never-created');
    assert.equal(row.rentExpected,'42');
  } finally {rmSync(f.directory,{recursive:true,force:true});}
});

test('closed PDA is reconciled from unique terminal history and transaction balances without sending any instruction',async()=>{
  const f=fixture();
  try {
    const row=f.report.missions[3]!;
    row.beforeCreate={client:'20',agent:'0',clientLamports:'1000'};
    row.afterCreate={client:'15',agent:'0',clientLamports:'958'};
    row.beforeSettlement={client:'15',agent:'0',clientLamports:'958'};row.rentExpected='42';
    const definitions=[['create_mission','MissionCreated'],['accept_mission','MissionAccepted'],
      ['submit_delivery','DeliverySubmitted'],['record_verdict','VerdictRecorded'],['finalize','MissionRefunded']];
    const history=definitions.map(([instruction,name],index)=>({instruction:instruction!,
      receipt:{signature:'signature-'+index,events:[{name:name!,data:{mission:row.address,amount:'5',status:{refunded:{}}}}]}}));
    row.transactions=history.slice(0,-1).map(entry=>({instruction:entry.instruction,signature:entry.receipt.signature}));
    let sends=0,metadataReads=0;
    const runner={
      journal:f.journal,keys:{client:f.client,agent:f.agent},mission:async()=>null,
      missionHistory:async()=>[...history].reverse(),
      settlementBalances:async(signature:string)=>{metadataReads++;assert.equal(signature,'signature-4');
        return{before:{client:'15',agent:'0',clientLamports:'958'},after:{client:'20',agent:'0',clientLamports:'1000'}};},
      connection:{getAccountInfo:async()=>null,getSignaturesForAddress:async()=>history.map(entry=>({signature:entry.receipt.signature,err:null}))},
      instruction:async():Promise<Receipt>=>{sends++;throw new Error('Closed mission must not execute');},
      execute:async():Promise<Receipt>=>{sends++;throw new Error('Closed mission must not execute');},
    } as unknown as RpcRunner;
    await settleMission(runner,f.report,row);
    assert.equal(sends,0);assert.equal(metadataReads,1);
    assert.equal(row.finalStatus,'refunded');assert.equal(row.rentReturned,'42');
    assert.equal(row.missionClosed,true);assert.equal(row.vaultClosed,true);
    assert.equal(row.transactions.length,5);assert.equal(row.transactions.at(-1)?.signature,'signature-4');
    await settleMission(runner,f.report,row);
    assert.equal(sends,0);assert.equal(metadataReads,1);
  } finally {rmSync(f.directory,{recursive:true,force:true});}
});

test('creation proven absent after expiry consumes the old ID and retries the normal pipeline with a future deadline',async()=>{
  const f=fixture();
  try {
    const row=f.report.missions[8]!,oldAddress=row.address;
    row.beforeCreate={client:'20',agent:'0',clientLamports:'1000'};row.deadline='101';
    const oldOperation=oldAddress+':create_mission';
    const original={operation:oldOperation,signature:'expired-creation',bytes:'retained-original-bytes',blockhash:'old',
      lastValidBlockHeight:100,signedSlot:0,broadcastAttempted:true,state:'signed'};
    f.journal.write('tx:'+oldOperation,original);
    const reserved=new Set(['9']);const attempts:Array<{id:string;deadline:bigint}>=[];
    let created=false;
    const runner={
      journal:f.journal,keys:{client:f.client,agent:f.agent},
      isReserved:(id:bigint)=>reserved.has(id.toString()),now:async()=>1000n,
      missionHistory:async()=>[],
      connection:{getAccountInfo:async()=>null,getMultipleAccountsInfo:async()=>[{lamports:20},{lamports:22}]},
      balances:async()=>({client:created?'15':'20',agent:'0',clientLamports:created?'958':'1000'}),
      instruction:async(operation:string,_name:string,_address:PublicKey,_signer:Keypair,args:{mission_id:bigint;deadline:bigint})=>{
        attempts.push({id:args.mission_id.toString(),deadline:args.deadline});
        if(args.mission_id===9n) {
          // RpcRunner's transport test independently verifies when this proof may be recorded.
          f.journal.write('tx:'+oldOperation,{...original,state:'expired-not-landed',
            expiredAttempts:[{signature:original.signature,lastValidBlockHeight:100,finalizedHeight:101,outcome:'expired-not-landed'}]});
          throw new CreationExpiredWithoutExecution(original.signature);
        }
        assert.equal(args.mission_id,11n);assert(args.deadline>1000n);
        assert(!reserved.has(args.mission_id.toString()));reserved.add(args.mission_id.toString());created=true;
        const receipt={signature:'fresh-creation',events:[]};
        f.journal.write('tx:'+operation,{operation,signature:receipt.signature,state:'confirmed',receipt});
        return receipt;
      },
    } as unknown as RpcRunner;
    await createMission(runner,f.report,row);
    assert.deepEqual(attempts,[{id:'9',deadline:101n},{id:'11',deadline:1010n}]);
    assert.equal(row.missionId,'11');assert.equal(row.deadline,'1010');
    assert(reserved.has('9'));assert(reserved.has('11'));
    const consumed=row.consumedIds?.[0];assert(consumed);
    assert.equal(consumed.id,'9');assert.equal(consumed.status,'consumed-never-created');
    assert.equal(consumed.expiredSignature,'expired-creation');assert.equal(consumed.finalizedHeight,101);
    assert.equal(consumed.lastValidBlockHeight,100);assert.equal(consumed.signatureCount,0);
    assert.equal(f.journal.read<{state:string}>('tx:'+oldOperation)?.state,'expired-not-landed');
    assert.equal(row.transactions.length,1);assert.equal(row.transactions[0]?.signature,'fresh-creation');
  } finally {rmSync(f.directory,{recursive:true,force:true});}
});
