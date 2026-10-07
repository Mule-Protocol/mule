import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { test, after } from 'node:test';
import { LiteSVM, FailedTransactionMetadata, type TransactionMetadata } from 'litesvm';
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, createInitializeMint2Instruction,
  createInitializeAccount3Instruction, createMintToInstruction, createTransferInstruction } from '@solana/spl-token';
import { MuleClient, PROGRAM_ID, TOKEN_PROGRAM_ID, UPGRADEABLE_LOADER_ID, configPda, missionPda,
  vaultPda, programDataPda, missionStatus, STALE_SECONDS, type Idl, type InstructionName } from '../packages/sdk/src/index.js';

const sdk = new MuleClient(JSON.parse(readFileSync('target/idl/mule_escrow.json', 'utf8')) as Idl);
const hash = Array<number>(32).fill(7);
const evidence: Array<{ test: string; instruction: InstructionName; outcome: string; events: string[] }> = [];
const cases: Array<{ name: string; passed: boolean }> = [];
let activeTest = '';
const definitions: Array<{name:string;body:()=>void}> = [];
function check(name:string,body:()=>void):void { definitions.push({name,body}); }
class Fixture {
  svm = new LiteSVM();
  payer = Keypair.generate();
  deployer = Keypair.generate();
  client = Keypair.generate();
  agent = Keypair.generate();
  validator = Keypair.generate();
  stranger = Keypair.generate();
  mint: PublicKey;
  clientToken: PublicKey;
  agentToken: PublicKey;
  strangerToken: PublicKey;
  id = 1n;
  mission = missionPda(this.client.publicKey, this.id)[0];
  vault = vaultPda(this.mission)[0];
  deadline = 1_700_000_100n;
  constructor(initialize = true) {
    this.svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/mule_escrow.so');
    this.time(1_700_000_000n);
    for (const wallet of [this.payer, this.deployer, this.client, this.agent, this.validator, this.stranger]) {
      const result = this.svm.airdrop(wallet.publicKey, 10_000_000_000n);
      assert(!(result instanceof FailedTransactionMetadata));
    }
    // Loader-owned canonical ProgramData fixture: only setup is injected.
    // Every MULE/SPL state transition below executes the compiled program.
    const loaded = this.svm.getAccount(programDataPda()[0]);
    assert(loaded && loaded.data.length > 45 && loaded.owner.equals(UPGRADEABLE_LOADER_ID));
    const data = Buffer.from(loaded.data);
    data.writeUInt32LE(3); data.writeBigUInt64LE(0n, 4); data[12] = 1;
    this.deployer.publicKey.toBuffer().copy(data, 13);
    this.svm.setAccount(programDataPda()[0], {
      data, executable: false, owner: UPGRADEABLE_LOADER_ID,
      lamports: loaded.lamports,
    });
    this.mint = this.newMint();
    this.clientToken = this.newToken(this.client.publicKey);
    this.agentToken = this.newToken(this.agent.publicKey);
    this.strangerToken = this.newToken(this.stranger.publicKey);
    this.send([createMintToInstruction(this.mint, this.clientToken, this.deployer.publicKey, 1_000_000_000n)], [this.deployer]);
    if (initialize) this.init();
  }
  time(timestamp: bigint): void {
    const clock = this.svm.getClock(); clock.unixTimestamp = timestamp; this.svm.setClock(clock);
  }
  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const result = this.raw(ixs, signers);
    if (result instanceof FailedTransactionMetadata) assert.fail(result.meta().logs().join('\n') + '\n' + result.toString());
    return result;
  }
  raw(ixs: TransactionInstruction[], signers: Keypair[]) {
    this.svm.expireBlockhash();
    const tx = new Transaction({ feePayer: this.payer.publicKey, recentBlockhash: this.svm.latestBlockhash() }).add(...ixs);
    const unique = new Map([this.payer, ...signers].map(k => [k.publicKey.toBase58(), k]));
    tx.sign(...unique.values());
    return this.svm.sendTransaction(tx);
  }
  newMint(decimals = 6): PublicKey {
    const key = Keypair.generate();
    this.send([SystemProgram.createAccount({fromPubkey:this.payer.publicKey,newAccountPubkey:key.publicKey,
      lamports:Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),space:MINT_SIZE,programId:TOKEN_PROGRAM_ID}),
    createInitializeMint2Instruction(key.publicKey, decimals, this.deployer.publicKey, null)], [key]);
    return key.publicKey;
  }
  newToken(owner: PublicKey, mint = this.mint): PublicKey {
    const key = Keypair.generate();
    this.send([SystemProgram.createAccount({fromPubkey:this.payer.publicKey,newAccountPubkey:key.publicKey,
      lamports:Number(this.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),space:ACCOUNT_SIZE,programId:TOKEN_PROGRAM_ID}),
    createInitializeAccount3Instruction(key.publicKey,mint,owner)], [key]);
    return key.publicKey;
  }
  accounts(signer: Keypair): Record<string, PublicKey> {
    return { deployer:signer.publicKey, admin:signer.publicKey, actor:signer.publicKey,
      validator:signer.publicKey, caller:signer.publicKey, config:configPda()[0], program_data:programDataPda()[0],
      mint:this.mint, client:this.client.publicKey, mission:this.mission, vault:this.vault,
      client_token:this.clientToken, agent_token:this.agentToken, token_program:TOKEN_PROGRAM_ID,
      system_program:SystemProgram.programId };
  }
  call(name: InstructionName, signer: Keypair, args: Record<string,unknown> = {},
    changes: Record<string,PublicKey> = {}, error?: string): TransactionMetadata | undefined {
    const previous = this.svm.getAccount(this.mission);
    const priorStatus = previous && previous.data.length > 0
      ? missionStatus(sdk.decodeMission(Buffer.from(previous.data))) : undefined;
    const ix = sdk.instruction(name, {...this.accounts(signer),...changes}, args);
    const result = this.raw([ix],[signer]);
    if (error !== undefined) {
      assert(result instanceof FailedTransactionMetadata, name + ' unexpectedly succeeded');
      const logs = result.meta().logs().join('\n');
      assert(logs.includes(error), name + ' expected ' + error + '\n' + logs + '\n' + result.toString());
      evidence.push({test:activeTest,instruction:name,outcome:'rejected: '+error,events:[]});
      return undefined;
    }
    if (result instanceof FailedTransactionMetadata) assert.fail(name + '\n' + result.meta().logs().join('\n'));
    const events=sdk.events(result.logs(), null);
    assert.equal(events.length,1,'one MULE event per successful instruction');
    if (!name.endsWith('_config')) {
      assert((events[0]?.data.mission as PublicKey).equals(this.mission));
      assert.equal(String(events[0]?.data.amount),'5000000');
      const expected:Record<string,[string,string]>={
        create_mission:['MissionCreated','open'],accept_mission:['MissionAccepted','accepted'],
        submit_delivery:['DeliverySubmitted','submitted'],record_verdict:['VerdictRecorded',args.pass?'passed':'failed'],
        open_dispute:['DisputeOpened','disputed'],cancel_mission:['MissionCancelled','cancelled'],
        refund_expired:['MissionRefunded','refunded'],refund_stale:['MissionRefunded','refunded'],
        finalize:priorStatus==='passed'?['MissionSettled','settled']:['MissionRefunded','refunded'],
        resolve_dispute:args.pay_agent?['MissionSettled','settled']:['MissionRefunded','refunded'],
      };
      const expectedEvent=expected[name];assert(expectedEvent);
      assert.equal(events[0]?.name.replaceAll('_','').toLowerCase(),expectedEvent[0].toLowerCase());
      const status=Object.keys(events[0]?.data.status as object)[0];
      assert.equal(status?.toLowerCase(),expectedEvent[1]);
    }
    evidence.push({test:activeTest,instruction:name,outcome:'success',events:events.map(e=>e.name)});
    return result;
  }
  init(error?: string, signer=this.deployer, mint=this.mint) {
    return this.call('initialize_config',signer,{admin:this.deployer.publicKey,validator:this.validator.publicKey},{mint},error);
  }
  update(paused=false, error?: string, signer=this.deployer, changes: Record<string,unknown>={}) {
    return this.call('update_config',signer,{validator:this.validator.publicKey,min_dispute_window:60n,max_amount:100_000_000n,paused,...changes},{},error);
  }
  create(changes: Record<string,unknown>={}, error?: string, accounts: Record<string,PublicKey>={}) {
    return this.call('create_mission',this.client,{mission_id:this.id,amount:5_000_000n,criteria_hash:hash,
      criteria_uri:'https://example.invalid/criteria.json',deadline:this.deadline,dispute_window:3600n,...changes},accounts,error);
  }
  accept(error?: string, signer=this.agent) { return this.call('accept_mission',signer,{}, {},error); }
  submit(error?: string, signer=this.agent, uri='https://example.invalid/delivery.json') {
    return this.call('submit_delivery',signer,{delivery_hash:hash,delivery_uri:uri},{},error);
  }
  verdict(pass=true,error?: string,signer=this.validator) {
    return this.call('record_verdict',signer,{pass,report_hash:hash},{},error);
  }
  dispute(error?: string,signer=this.client) { return this.call('open_dispute',signer,{}, {},error); }
  finish(error?: string,changes:Record<string,PublicKey>={}) {
    return this.call('finalize',this.stranger,{},changes,error);
  }
  refund(name: 'cancel_mission'|'refund_expired'|'refund_stale',error?:string,signer=this.client,
    changes:Record<string,PublicKey>={}) { return this.call(name,signer,{},changes,error); }
  resolve(pay_agent=true,error?:string,signer=this.deployer,changes:Record<string,PublicKey>={}) {
    return this.call('resolve_dispute',signer,{pay_agent},changes,error);
  }
  state() {
    const account=this.svm.getAccount(this.mission); assert(account);
    return sdk.decodeMission(Buffer.from(account.data));
  }
  balance(account:PublicKey):bigint {
    const value=this.svm.getAccount(account); assert(value);
    return AccountLayout.decode(Buffer.from(value.data)).amount;
  }
  closed() {
    for(const key of [this.mission,this.vault]) {
      const value=this.svm.getAccount(key);
      assert(value===null || (value.lamports===0 && value.data.length===0),'account must be closed');
    }
  }
  prepared(status='submitted') {
    this.create(); if(status==='open') return;
    this.accept(); if(status==='accepted') return;
    this.submit(); if(status==='submitted') return;
    this.verdict(status!=='failed'); if(status==='disputed') this.dispute();
  }
}

check('initialize_config: defaults, authority and six-decimal mint',()=>{
  const f=new Fixture(false); f.init('Unauthorized',f.stranger);
  f.init('InvalidMint',f.deployer,f.newMint(9)); f.init();
  const value=f.svm.getAccount(configPda()[0]); assert(value);
  const config=sdk.decodeConfig(Buffer.from(value.data));
  assert(config.admin.equals(f.deployer.publicKey)); assert(config.validator.equals(f.validator.publicKey));
  assert(config.mint.equals(f.mint)); assert.equal(config.minDisputeWindow.toString(),'3600');
  assert.equal(config.maxAmount.toString(),'100000000'); assert.equal(config.paused,false);
  const ix=sdk.instruction('initialize_config',f.accounts(f.deployer),{admin:f.deployer.publicKey,validator:f.validator.publicKey});
  assert(f.raw([ix],[f.deployer]) instanceof FailedTransactionMetadata,'config cannot be initialized twice');
});
check('initialize_config: forged ProgramData PDA rejected',()=>{
  const f=new Fixture(false);
  f.call('initialize_config',f.deployer,{admin:f.deployer.publicKey,validator:f.validator.publicKey},
    {program_data:f.mint},'AccountOwnedByWrongProgram');
});
check('initialize_config: zero authority rejected',()=>{
  const f=new Fixture(false);
  f.call('initialize_config',f.deployer,{admin:PublicKey.default,validator:f.validator.publicKey},{},'InvalidAuthority');
});
check('update_config: restricted, immutable mint/admin, bounds and validator rotation',()=>{
  const f=new Fixture(); f.update(false,'Unauthorized',f.stranger);
  f.update(false,'InvalidConfig',f.deployer,{min_dispute_window:0n});
  f.update(false,'InvalidConfig',f.deployer,{max_amount:0n});
  f.update(false,'InvalidAuthority',f.deployer,{validator:PublicKey.default});
  f.update(false,undefined,f.deployer,{validator:f.stranger.publicKey});
  f.prepared(); f.verdict(true,'Unauthorized'); f.verdict(true,undefined,f.stranger);
});
check('create_mission: exact escrow, immutable criteria and initialized state',()=>{
  const f=new Fixture(); const balance=f.balance(f.clientToken); f.create();
  const m=f.state(); assert.equal(missionStatus(m),'open'); assert.equal(m.agent,null);
  assert.equal(m.amount.toString(),'5000000'); assert.deepEqual(m.criteriaHash,hash);
  assert.equal(f.balance(f.clientToken),balance-5_000_000n); assert.equal(f.balance(f.vault),5_000_000n);
  const ix=sdk.instruction('create_mission',f.accounts(f.client),{mission_id:1n,amount:5_000_000n,
    criteria_hash:hash,criteria_uri:'x',deadline:f.deadline,dispute_window:3600n});
  assert(f.raw([ix],[f.client]) instanceof FailedTransactionMetadata,'duplicate open mission rejected');
});
check('create_mission: invalid amount, deadline, window, URI and overflow',()=>{
  const f=new Fixture();
  f.create({amount:0n},'InvalidAmount'); f.create({amount:100_000_001n},'InvalidAmount');
  f.create({deadline:1_700_000_000n},'InvalidDeadline');
  f.create({dispute_window:3599n},'InvalidWindow');
  f.create({criteria_uri:''},'InvalidUri'); f.create({criteria_uri:'é'.repeat(101)},'InvalidUri');
  f.create({deadline:(1n<<63n)-1n},'ArithmeticOverflow');
  f.create({dispute_window:(1n<<63n)-1n},'ArithmeticOverflow');
  f.create({criteria_uri:'x'.repeat(200)});
});
check('create_mission: wrong mint, token authority and PDA substitutions',()=>{
  const f=new Fixture(); const otherMint=f.newMint();
  f.create({},'InvalidMint',{mint:otherMint});
  f.create({},'ConstraintTokenOwner',{client_token:f.strangerToken});
  const otherToken=f.newToken(f.client.publicKey,otherMint);
  f.create({},'ConstraintTokenMint',{client_token:otherToken});
  f.create({},'ConstraintSeeds',{mission:missionPda(f.client.publicKey,2n)[0]});
  f.create({},'ConstraintSeeds',{vault:vaultPda(missionPda(f.client.publicKey,2n)[0])[0]});
});
check('create_mission: missing client signature rejected',()=>{
  const f=new Fixture();
  const ix=sdk.instruction('create_mission',f.accounts(f.client),{mission_id:1n,amount:5_000_000n,criteria_hash:hash,
    criteria_uri:'x',deadline:f.deadline,dispute_window:3600n});
  for(const key of ix.keys) if(key.pubkey.equals(f.client.publicKey)) key.isSigner=false;
  const result=f.raw([ix],[]); assert(result instanceof FailedTransactionMetadata);
  assert(result.meta().logs().join('\n').includes('AccountNotSigner'));
});
check('cancel_mission: client only, full refund, vault/mission rent returned to client',()=>{
  const f=new Fixture(); const before=f.balance(f.clientToken); f.create();
  const missionRent=f.svm.getBalance(f.mission)??0n; const vaultRent=f.svm.getBalance(f.vault)??0n;
  const sol=f.svm.getBalance(f.client.publicKey)??0n;
  f.refund('cancel_mission','Unauthorized',f.stranger); f.refund('cancel_mission');
  assert.equal(f.balance(f.clientToken),before); assert.equal(f.svm.getBalance(f.client.publicKey),sol+missionRent+vaultRent); f.closed();
});
check('accept_mission: client cannot accept and expiry is enforced',()=>{
  const f=new Fixture(); f.create(); f.accept('ClientCannotAccept',f.client);
  f.time(f.deadline); f.accept('DeadlineElapsed');
});
check('accept/submit: correct agent, immutable delivery, byte limits and deadline boundary',()=>{
  const f=new Fixture(); f.create(); f.accept(); assert(f.state().agent?.equals(f.agent.publicKey));
  f.submit('Unauthorized',f.stranger); f.submit('InvalidUri',f.agent,'é'.repeat(101));
  f.submit(undefined,f.agent,'x'.repeat(200)); assert.equal(missionStatus(f.state()),'submitted');
  assert.deepEqual(f.state().deliveryHash,hash); f.submit('InvalidState');
  const g=new Fixture(); g.create();g.accept();g.time(g.deadline);g.submit('DeadlineElapsed');
});
check('record_verdict: restricted, exactly once, hashes and timestamp',()=>{
  const f=new Fixture(); f.prepared(); f.verdict(true,'Unauthorized',f.stranger);
  f.verdict(); assert.equal(missionStatus(f.state()),'passed'); assert.deepEqual(f.state().reportHash,hash);
  assert.equal(f.state().verdictAt?.toString(),'1700000000'); f.verdict(false,'InvalidState');
});
for(const pass of [true,false]) check('finalize '+(pass?'passed':'failed')+': window boundary, payee, closure, replay',()=>{
  const f=new Fixture(); const original=f.balance(f.clientToken); f.prepared(); f.verdict(pass);
  f.finish('WindowStillOpen'); f.time(1_700_003_599n); f.finish('WindowStillOpen');
  f.time(1_700_003_600n); f.finish();
  assert.equal(f.balance(f.agentToken),pass?5_000_000n:0n);
  assert.equal(f.balance(f.clientToken),pass?original-5_000_000n:original); f.closed();
  f.finish('AccountNotInitialized');
});
for(const pass of [true,false]) for(const party of ['client','agent'] as const)
  check('open_dispute from '+(pass?'passed':'failed')+' by '+party,()=>{
    const f=new Fixture(); f.prepared();f.verdict(pass);f.dispute('Unauthorized',f.stranger);
    f.time(1_700_003_599n);f.dispute(undefined,f[party]);assert.equal(missionStatus(f.state()),'disputed');
    f.time(1_700_003_600n);f.finish('InvalidState');f.refund('refund_stale','InvalidState');
  });
check('open_dispute: exact closed boundary rejected',()=>{
  const f=new Fixture();f.prepared();f.verdict();f.time(1_700_003_600n);f.dispute('WindowClosed');
});
for(const pay of [true,false]) check('resolve_dispute '+(pay?'pay':'refund')+': admin only, exact recipient, close',()=>{
  const f=new Fixture();const original=f.balance(f.clientToken);f.prepared('disputed');
  f.resolve(pay,'Unauthorized',f.stranger);f.resolve(pay);
  assert.equal(f.balance(f.agentToken),pay?5_000_000n:0n);
  assert.equal(f.balance(f.clientToken),pay?original-5_000_000n:original);f.closed();
});
for(const state of ['open','accepted']) check('refund_expired from '+state+': deadline and permissionless refund',()=>{
  const f=new Fixture();const before=f.balance(f.clientToken);f.prepared(state);
  f.refund('refund_expired','NotExpired',f.stranger);f.time(f.deadline-1n);f.refund('refund_expired','NotExpired',f.stranger);
  f.time(f.deadline);f.refund('refund_expired',undefined,f.stranger);assert.equal(f.balance(f.clientToken),before);f.closed();
});
check('refund_stale: exactly deadline + 7 days, permissionless and no verdict',()=>{
  const f=new Fixture();const before=f.balance(f.clientToken);f.prepared();
  f.refund('refund_stale','NotStale',f.stranger);f.time(f.deadline+STALE_SECONDS-1n);f.refund('refund_stale','NotStale',f.stranger);
  f.time(f.deadline+STALE_SECONDS);f.refund('refund_stale',undefined,f.stranger);assert.equal(f.balance(f.clientToken),before);f.closed();
});
for(const pass of [true,false]) check('refund_stale: cannot bypass recorded '+(pass?'pass':'fail'),()=>{
  const f=new Fixture();f.prepared();f.verdict(pass);f.time(f.deadline+STALE_SECONDS);
  f.refund('refund_stale','InvalidState',f.stranger);
});
check('paused: create blocked, every exit and in-flight step remains available',()=>{
  const f=new Fixture();f.update(true);f.create({},'Paused');
  for(const route of ['cancel','finalize-pass','finalize-fail','expired','stale','resolve-pay','resolve-refund']) {
    const g=new Fixture();g.create();g.update(true);
    if(route==='cancel') g.refund('cancel_mission');
    else if(route==='expired'){g.accept();g.time(g.deadline);g.refund('refund_expired',undefined,g.stranger);}
    else {g.accept();g.submit();
      if(route==='stale'){g.time(g.deadline+STALE_SECONDS);g.refund('refund_stale',undefined,g.stranger);}
      else {g.verdict(route!=='finalize-fail');
        if(route.startsWith('resolve')){g.dispute();g.resolve(route==='resolve-pay');}
        else {g.time(1_700_003_600n);g.finish();}
      }
    }g.closed();
  }
});
check('settlement/refund: destination substitution and wrong vault cannot steal funds',()=>{
  const f=new Fixture();f.prepared();f.verdict();f.time(1_700_003_600n);
  f.finish('Unauthorized',{agent_token:f.strangerToken});
  f.finish('ConstraintTokenOwner',{client_token:f.strangerToken});
  f.finish('ConstraintHasOne',{client:f.stranger.publicKey});
  f.finish('ConstraintSeeds',{vault:f.clientToken});
  assert.equal(f.balance(f.vault),5_000_000n);f.finish();
  const g=new Fixture();g.create();g.refund('cancel_mission','ConstraintTokenOwner',g.client,{client_token:g.strangerToken});
  assert.equal(g.balance(g.vault),5_000_000n);g.refund('cancel_mission');
});
check('unsolicited vault tokens cannot prevent closure',()=>{
  const f=new Fixture();f.create();
  f.send([createTransferInstruction(f.clientToken,f.vault,f.client.publicKey,123n)],[f.client]);
  f.refund('cancel_mission');assert.equal(f.balance(f.clientToken),1_000_000_000n);f.closed();
});
const invalidByState: Record<string, InstructionName[]> = {
  open:['submit_delivery','record_verdict','open_dispute','resolve_dispute','finalize','refund_stale'],
  accepted:['cancel_mission','accept_mission','record_verdict','open_dispute','resolve_dispute','finalize','refund_stale'],
  submitted:['cancel_mission','accept_mission','submit_delivery','open_dispute','resolve_dispute','finalize','refund_expired'],
  passed:['cancel_mission','accept_mission','submit_delivery','record_verdict','resolve_dispute','refund_expired','refund_stale'],
  failed:['cancel_mission','accept_mission','submit_delivery','record_verdict','resolve_dispute','refund_expired','refund_stale'],
  disputed:['cancel_mission','accept_mission','submit_delivery','record_verdict','open_dispute','finalize','refund_expired','refund_stale'],
};
for(const [state,instructions] of Object.entries(invalidByState)) check('state machine rejects every forbidden outgoing instruction from '+state,()=>{
  const f=new Fixture();f.prepared(state);
  for(const name of instructions) {
    const before=Buffer.from(f.svm.getAccount(f.mission)!.data);
    const args=name==='submit_delivery'?{delivery_hash:hash,delivery_uri:'x'}
      :name==='record_verdict'?{pass:true,report_hash:hash}:name==='resolve_dispute'?{pay_agent:true}:{};
    const signer=name==='record_verdict'?f.validator:name==='resolve_dispute'?f.deployer
      :name==='submit_delivery'||name==='accept_mission'?f.agent:f.client;
    const error=state==='open' && ['submit_delivery','finalize','resolve_dispute'].includes(name)?'Unauthorized':'InvalidState';
    f.call(name,signer,args,{},error);
    assert.deepEqual(Buffer.from(f.svm.getAccount(f.mission)!.data),before,'failure must roll back');
  }
});
if(process.env.MULE_LIST_TESTS==='1') {
  console.log(JSON.stringify(definitions.map(d=>d.name)));
} else {
  const selected=process.env.MULE_CASE_INDEX;
  for(const [index,definition] of definitions.entries()) {
    if(selected!==undefined && Number(selected)!==index)continue;
    test(definition.name,()=>{
      activeTest=definition.name;
      const item={name:definition.name,passed:false};cases.push(item);
      definition.body();item.passed=true;
    });
  }
  after(()=>{
    mkdirSync('coverage',{recursive:true});
    writeFileSync(process.env.MULE_COVERAGE_PART??'coverage/instructions.json',
      JSON.stringify({engine:'LiteSVM 0.8.0, compiled SBF',cases,evidence},null,2));
  });
}