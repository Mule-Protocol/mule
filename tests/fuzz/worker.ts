import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { AccountLayout, ACCOUNT_SIZE, MINT_SIZE, createInitializeMint2Instruction,
  createInitializeAccount3Instruction, createMintToInstruction } from '@solana/spl-token';
import { MuleClient, PROGRAM_ID, TOKEN_PROGRAM_ID, UPGRADEABLE_LOADER_ID, configPda, missionPda,
  vaultPda, programDataPda, missionStatus, InMemoryMissionIdHistory, type Idl, type InstructionName } from '../../packages/sdk/src/index.js';
import { apply, decide, I64_MAX, live, planClock, type Attempt, type Command, type MissionModel, type Model, type Operation } from './model.js';

const inputPath = process.argv[2]!, outputPath = process.argv[3]!;
const commands = JSON.parse(readFileSync(inputPath, 'utf8')) as Command[];
const stats = { instructions: 0, successful: 0, rejected: 0, clockJumps: 0, invariantChecks: 0,
  byInstruction: {} as Record<string, { success: number; rejected: number }>,
  boundariesRequested: {} as Record<string,number>, boundariesReached: {} as Record<string,number>,
  boundariesClamped: {} as Record<string,number>, boundariesUnavailable: {} as Record<string,number> };
const trace: Record<string, unknown>[] = [];
const hash = Array<number>(32).fill(71);
const INITIAL = 1_000_000_000_000n;
function key(label: string): Keypair {
  // Publicly derivable test-only identities. Never leave the in-memory isolated VM.
  return Keypair.fromSeed(createHash('sha256').update('MULE FUZZ TEST ONLY ' + label).digest());
}
class World {
  readonly svm = new LiteSVM();
  readonly payer = key('fees');
  readonly upgrade = key('upgrade');
  readonly actors = Array.from({length: 6}, (_, index) => key('role ' + index));
  readonly mintKey = key('mint');
  readonly mint = this.mintKey.publicKey;
  readonly tokens = this.actors.map((_, index) => key('token ' + index).publicKey);
  readonly sdk = new MuleClient(JSON.parse(readFileSync('target/idl/mule_escrow.json', 'utf8')) as Idl, PROGRAM_ID, new InMemoryMissionIdHistory());
  readonly model: Model = { now: 1_700_000_000n, config: {admin:4,validator:3,pending:null,minWindow:3600n,cap:100_000_000n,paused:false}, missions:[],nextId:1n };

  constructor() {
    this.svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/mule_escrow.so');
    this.clock(this.model.now);
    for (const wallet of [this.payer, this.upgrade, ...this.actors]) {
      assert(!(this.svm.airdrop(wallet.publicKey, 100_000_000_000n) instanceof FailedTransactionMetadata));
    }
    const loaded = this.svm.getAccount(programDataPda()[0]);
    assert(loaded && loaded.owner.equals(UPGRADEABLE_LOADER_ID) && loaded.data.length > 45);
    const data = Buffer.from(loaded.data);
    data.writeUInt32LE(3); data.writeBigUInt64LE(0n, 4); data[12] = 1;
    this.upgrade.publicKey.toBuffer().copy(data, 13);
    this.svm.setAccount(programDataPda()[0], {data, executable:false, owner:UPGRADEABLE_LOADER_ID,lamports:loaded.lamports});
    this.send([SystemProgram.createAccount({fromPubkey:this.payer.publicKey,newAccountPubkey:this.mint,
      space:MINT_SIZE,lamports:Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),programId:TOKEN_PROGRAM_ID}),
      createInitializeMint2Instruction(this.mint,6,this.upgrade.publicKey,null)], [this.mintKey]);
    for (let index=0;index<6;index++) {
      const token = key('token ' + index);
      this.send([SystemProgram.createAccount({fromPubkey:this.payer.publicKey,newAccountPubkey:token.publicKey,
        space:ACCOUNT_SIZE,lamports:Number(this.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),programId:TOKEN_PROGRAM_ID}),
        createInitializeAccount3Instruction(token.publicKey,this.mint,this.actors[index]!.publicKey),
        createMintToInstruction(this.mint,token.publicKey,this.upgrade.publicKey,INITIAL)], [token,this.upgrade]);
    }
    const ix = this.sdk.instruction('initialize_config', {deployer:this.upgrade.publicKey,program_data:programDataPda()[0],
      config:configPda()[0],mint:this.mint,system_program:SystemProgram.programId},
      {admin:this.actors[4]!.publicKey,validator:this.actors[3]!.publicKey});
    this.send([ix],[this.upgrade]);
    this.count('initialize_config',true);
    this.invariants();
  }
  raw(ixs: TransactionInstruction[], signers: Keypair[]) {
    this.svm.expireBlockhash();
    const tx = new Transaction({feePayer:this.payer.publicKey,recentBlockhash:this.svm.latestBlockhash()}).add(...ixs);
    tx.sign(...new Map([this.payer,...signers].map(signer=>[signer.publicKey.toBase58(),signer])).values());
    return this.svm.sendTransaction(tx);
  }
  send(ixs: TransactionInstruction[], signers: Keypair[]): void {
    const result=this.raw(ixs,signers);
    assert(!(result instanceof FailedTransactionMetadata),result instanceof FailedTransactionMetadata?result.meta().logs().join('\n'):'');
  }
  count(op: Operation, success: boolean): void {
    stats.instructions++; stats[success?'successful':'rejected']++;
    stats.byInstruction[op] ??= {success:0,rejected:0};
    stats.byInstruction[op]![success?'success':'rejected']++;
  }
  clock(now: bigint): void {
    const clock=this.svm.getClock();clock.unixTimestamp=now;this.svm.setClock(clock);
  }
  address(m: MissionModel): PublicKey { return missionPda(this.actors[m.client]!.publicKey,m.id)[0]; }
  balances(): bigint[] {
    return this.tokens.map(token=>{const account=this.svm.getAccount(token);assert(account);return AccountLayout.decode(Buffer.from(account.data)).amount;});
  }
  lamports(): bigint[] { return this.actors.map(actor=>BigInt(this.svm.getAccount(actor.publicKey)!.lamports)); }
  absent(address: PublicKey): boolean {
    const account=this.svm.getAccount(address);
    return account===null || (account.lamports===0 && account.data.length===0);
  }
  modelSnapshot(): string {
    return JSON.stringify([configPda()[0],...this.model.missions.flatMap(m=>[this.address(m),vaultPda(this.address(m))[0]])]
      .map(address=>{const a=this.svm.getAccount(address);return a?{lamports:a.lamports,data:Buffer.from(a.data).toString('hex')}:null;}));
  }
  invariants(): void {
    let total=this.balances().reduce((a,b)=>a+b,0n);
    for (const m of this.model.missions) {
      const address=this.address(m),vault=vaultPda(address)[0];
      if (!live(m.state)) {
        assert(this.absent(address)&&this.absent(vault),'Invariant 4: terminal/failed mission accounts closed');
        continue;
      }
      const account=this.svm.getAccount(address),token=this.svm.getAccount(vault);
      assert(account&&token,'Invariant 2: live mission has a vault');
      const decoded=this.sdk.decodeMission(Buffer.from(account.data));
      const balance=AccountLayout.decode(Buffer.from(token.data)).amount; total+=balance;
      assert.equal(balance,m.amount,'Invariant 2: exact vault amount (no donation alphabet)');
      assert.equal(BigInt(decoded.amount.toString()),m.amount);
      assert.equal(missionStatus(decoded),m.state,'Invariant 5: state matches independent model');
      assert(decoded.client.equals(this.actors[m.client]!.publicKey));
      assert.equal(decoded.agent?.toBase58()??null,m.agent===null?null:this.actors[m.agent]!.publicKey.toBase58());
      assert.equal(decoded.designatedAgent?.toBase58()??null,m.designated===null?null:this.actors[m.designated]!.publicKey.toBase58());
      assert.equal(BigInt(decoded.missionId.toString()),m.id);
      assert.equal(BigInt(decoded.deadline.toString()),m.deadline);
      assert.equal(BigInt(decoded.disputeWindow.toString()),m.window);
      assert.equal(decoded.verdictAt===null?null:BigInt(decoded.verdictAt.toString()),m.verdictAt);
      assert.equal(decoded.disputedAt===null?null:BigInt(decoded.disputedAt.toString()),m.disputedAt);
      assert.equal(decoded.originalVerdict,m.verdict);
      assert.deepEqual(decoded.criteriaHash,hash);
    }
    assert.equal(total,INITIAL*6n,'Invariant 1: conservation across all role wallets and vaults');
    const account=this.svm.getAccount(configPda()[0]);assert(account);
    const c=this.sdk.decodeConfig(Buffer.from(account.data)),model=this.model.config;
    assert(c.admin.equals(this.actors[model.admin]!.publicKey));assert(c.validator.equals(this.actors[model.validator]!.publicKey));
    assert.equal(c.pendingAdmin?.toBase58()??null,model.pending===null?null:this.actors[model.pending]!.publicKey.toBase58());
    assert.equal(c.paused,model.paused);assert.equal(BigInt(c.minDisputeWindow.toString()),model.minWindow);assert.equal(BigInt(c.maxAmount.toString()),model.cap);
    stats.invariantChecks++;
  }
  run(command: Command): void {
    let m=this.model.missions.length?this.model.missions[command.target%this.model.missions.length]:undefined;
    if(command.op==='clock') {
      const plan=planClock(this.model.now,m,command);
      const requestedLabel=command.boundary+':'+command.offset;
      stats.boundariesRequested[requestedLabel]=(stats.boundariesRequested[requestedLabel]??0)+1;
      if(plan.available) {
        const actualLabel=command.boundary+':'+plan.actualOffset;
        stats.boundariesReached[actualLabel]=(stats.boundariesReached[actualLabel]??0)+1;
      } else stats.boundariesUnavailable[requestedLabel]=(stats.boundariesUnavailable[requestedLabel]??0)+1;
      if(plan.clamp) {
        const clampedLabel=requestedLabel+':'+plan.clamp;
        stats.boundariesClamped[clampedLabel]=(stats.boundariesClamped[clampedLabel]??0)+1;
      }
      this.model.now=plan.actual;this.clock(plan.actual);stats.clockJumps++;
      trace.push({command,clock:String(plan.actual),requestedClock:String(plan.requested),
        reference:plan.reference===null?null:String(plan.reference),boundaryAvailable:plan.available,
        clamp:plan.clamp,actualOffset:plan.actualOffset===null?null:String(plan.actualOffset)});
      this.invariants();return;
    }
    let op:Operation=command.op==='progress'?'create_mission':command.op;
    if(command.op==='progress'&&m&&live(m.state)) {
      const actions:Record<string,Operation>={open:'accept_mission',accepted:'submit_delivery',submitted:'record_verdict',
        passed:command.flag?'open_dispute':'finalize',failed:command.flag?'open_dispute':'finalize',
        disputed:command.flag?'resolve_dispute':'finalize'};
      op=actions[m.state]!;
    }
    let actor=command.actor;
    if(actor<0) {
      if(['update_config','propose_admin','cancel_admin_proposal','resolve_dispute'].includes(op))actor=this.model.config.admin;
      else if(op==='accept_admin')actor=this.model.config.pending??5;
      else if(op==='record_verdict')actor=this.model.config.validator;
      else if(op==='cancel_mission'||op==='open_dispute')actor=m?.client??0;
      else if(op==='submit_delivery')actor=m?.agent??1;
      else if(op==='accept_mission')actor=m?.designated??[1,2,5,4,0,3].find(i=>i!==m?.client&&i!==this.model.config.validator)!;
      else if(op==='create_mission')actor=this.model.config.validator===0?1:0;
      else actor=5;
    }
    if(op==='create_mission') {
      const requested=command.offset===2147483647?I64_MAX:this.model.now+BigInt(command.offset);
      const deadline=requested>I64_MAX?I64_MAX:requested;
      m={id:this.model.nextId++,client:actor,agent:null,designated:command.other<6?command.other:null,
        amount:BigInt(command.amount),deadline,window:BigInt(command.window),state:'absent',verdictAt:null,
        disputedAt:null,verdict:null,rent:0n};
      this.model.missions.push(m);
    }
    const placeholder:MissionModel={id:0n,client:0,agent:null,designated:null,amount:0n,deadline:0n,window:3600n,
      state:'absent',verdictAt:null,disputedAt:null,verdict:null,rent:0n};
    m??=placeholder;
    const attempt:Attempt={operation:op,actor,mission:m,amount:BigInt(command.amount),window:BigInt(command.window),
      other:command.other,paused:command.flag,pay:command.flag,redirect:command.redirect};
    const beforeTokens=this.balances(),beforeSol=this.lamports(),beforeAccounts=this.modelSnapshot();
    const decision=decide(this.model,attempt,beforeTokens);
    const address=this.address(m),signer=this.actors[actor]!;
    const agent=m.agent??1;
    const keys:Record<string,PublicKey>={deployer:signer.publicKey,admin:signer.publicKey,pending_admin:signer.publicKey,
      actor:signer.publicKey,validator:signer.publicKey,caller:signer.publicKey,config:configPda()[0],
      program_data:programDataPda()[0],mint:this.mint,client:this.actors[m.client]!.publicKey,
      mission:address,vault:vaultPda(address)[0],client_token:this.tokens[m.client]!,agent_token:this.tokens[agent]!,
      token_program:TOKEN_PROGRAM_ID,system_program:SystemProgram.programId};
    if(command.redirect>=0) {
      if(['finalize','resolve_dispute'].includes(op))keys.agent_token=this.tokens[command.redirect]!;
      else keys.client_token=this.tokens[command.redirect]!;
    }
    const other=command.other<6?this.actors[command.other]!.publicKey:PublicKey.default;
    let args:Record<string,unknown>={};
    if(op==='initialize_config')args={admin:this.actors[4]!.publicKey,validator:this.actors[3]!.publicKey};
    if(op==='update_config')args={validator:other,min_dispute_window:BigInt(command.window),max_amount:BigInt(command.amount),paused:command.flag};
    if(op==='propose_admin')args={new_admin:other};
    if(op==='create_mission')args={mission_id:m.id,amount:m.amount,deadline:m.deadline,dispute_window:m.window,
      designated_agent:m.designated===null?null:this.actors[m.designated]!.publicKey,criteria_hash:hash,criteria_uri:'fuzz:criteria'};
    if(op==='submit_delivery')args={delivery_hash:hash,delivery_uri:'fuzz:delivery'};
    if(op==='record_verdict')args={pass:command.flag,report_hash:hash};
    if(op==='resolve_dispute')args={pay_agent:command.flag};
    const result=this.raw([this.sdk.instruction(op as InstructionName,keys,args)],[signer]);
    const succeeded=!(result instanceof FailedTransactionMetadata);
    this.count(op,succeeded);
    trace.push({command,operation:op,actor,missionId:String(m.id),now:String(this.model.now),before:m.state,
      expected:decision.pass,actual:succeeded,reason:decision.reason,
      logs:result instanceof FailedTransactionMetadata?result.meta().logs():undefined});
    assert.equal(succeeded,decision.pass,'Invariant 5: '+op+' '+decision.reason);
    if(succeeded&&op==='create_mission') {
      assert.notEqual(m.client,this.model.config.validator,'Invariant 6: validator client at creation');
      assert.notEqual(m.designated,this.model.config.validator,'Invariant 6: validator designated at creation');
    }
    if(succeeded&&op==='accept_mission')assert.notEqual(actor,this.model.config.validator,'Invariant 6: validator accepts under current mandate');
    apply(this.model,attempt,decision);
    if(succeeded&&op==='create_mission') {
      m.rent=BigInt(this.svm.getAccount(address)!.lamports)+BigInt(this.svm.getAccount(vaultPda(address)[0])!.lamports);
    }
    const afterTokens=this.balances(),afterSol=this.lamports();
    for(let i=0;i<6;i++) {
      let tokenDelta=0n,solDelta=0n;
      if(succeeded&&op==='create_mission'&&i===m.client){tokenDelta=-m.amount;solDelta=-m.rent;}
      if(succeeded&&decision.recipient!==undefined){
        if(i===decision.recipient)tokenDelta=m.amount;
        if(i===m.client)solDelta=m.rent;
      }
      assert.equal(afterTokens[i]!-beforeTokens[i]!,tokenDelta,'Invariant 3: only agreed client/agent receives escrow; actor '+i);
      assert.equal(afterSol[i]!-beforeSol[i]!,solDelta,'Invariant 7: all rent returned to client; actor '+i);
    }
    if(!succeeded)assert.equal(this.modelSnapshot(),beforeAccounts,'Rejected instruction changed account data');
    this.invariants();
  }
}
let passed=false,error: string|undefined;
try {
  const world=new World();
  for(const command of commands)world.run(command);
  passed=true;
} catch(failure) { error=failure instanceof Error?failure.stack:String(failure); }
writeFileSync(outputPath,JSON.stringify({passed,stats,trace,error},null,2)+'\n');
if(!passed)process.exitCode=1;
