import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { MINT_SIZE, createInitializeMint2Instruction, createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID, bnToBigInt, configPda, missionPda, missionStatus, vaultPda } from '@mule/sdk';
import { LocalContentStore, loadFixture } from '@mule/validator';
import { createDelivery } from '@mule/agent';
import { RpcRunner, pause, CreationExpiredWithoutExecution, type TransactionRecord } from './rpc.js';
import { durableJson } from './journal.js';
import { sweep, type Receipt } from './sweep.js';
import { validateMission, type ValidationResult } from './validate.js';

type Model = 'invoice.v1' | 'contract.v1' | 'address.v1';
type Mode = 'honest' | 'dishonest' | 'never-accepted' | 'never-delivered';
type Balance = Awaited<ReturnType<RpcRunner['balances']>>;
export interface Evidence {
  number: number; missionId: string; model: Model; mode: Mode; designated: boolean; dispute: boolean; address: string;
  amount: string; criteriaHash: string; criteriaUri: string; deliveryHash?: string; deliveryUri?: string;
  deadline: string; reportHash?: string; reportUri?: string; validatorMessage?: string; pass?: boolean;
  beforeCreate?: Balance; afterCreate?: Balance; beforeSettlement?: Balance; afterSettlement?: Balance;
  rentExpected?: string; rentReturned?: string; vaultClosed?: boolean; missionClosed?: boolean;
  finalStatus?: string; finalEvent?: string; recipient?: string; terminalInstruction?: string;
  transactions: Array<{instruction: string; signature: string}>;
  consumedIds?: Array<{id:string;address:string;status:'consumed-never-created';signatureCount:number;
    expiredSignature?:string;lastValidBlockHeight?:number;finalizedHeight?:number}>;
  reserveRecovery?: {fault:'after-reserve';firstExitCode:number;consumedId:string;consumedAddress:string;replacementId:string;chainSignaturesBefore:number;chainSignaturesAfter:number;neverReused:boolean};
  closeRecovery?: {fault:'after-close';firstExitCode:number;manifestStateAtCrash:'pending';terminalSignature:string;chainSignaturesBefore:number;chainSignaturesAfter:number;missionClosed:boolean;vaultClosed:boolean};
  idempotence?: {fault: string; firstExitCode: number; verdictsBeforeRestart: number; verdictsAfterRestart: number;
    originalReportHash: string; recoveredReportHash: string; sameReportHash: boolean; chainTransactionCount: number; uniqueSignatures: number; transactionJournalAtCrash: string; transactionJournalAfterRestart: string};
}
export interface CampaignReport {
  execution: 'solana-test-validator'; agent: 'agent de référence scripté'; runId: string; date: string;
  genesis: string; mint: string; program: string; minDisputeWindow: 60; missions: Evidence[];
  roles: Record<string, string>; setup: Array<{instruction: string; signature: string}>;
  simulatedOnly: string[]; checks: {total: number; paid: number; refunded: number; dishonestRefunded: number};
}
function remember(row: Evidence, instruction: string, receipt: Receipt): void {
  const old = row.transactions.find(entry => entry.instruction === instruction);
  if (old) assert.equal(old.signature, receipt.signature, 'Operation must retain the same signature');
  else row.transactions.push({instruction, signature: receipt.signature});
}
function hashBytes(hash: string): number[] { return Array.from(Buffer.from(hash, 'hex')); }

async function setup(runner: RpcRunner): Promise<Array<{instruction: string; signature: string}>> {
  const keyPath = join(runner.options.keyDirectory, 'localMint.json');
  let mintKey: Keypair;
  if (existsSync(keyPath)) mintKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8')) as number[]));
  else {
    mintKey = Keypair.generate();
    writeFileSync(keyPath, JSON.stringify(Array.from(mintKey.secretKey)), {flag: 'wx', mode: 0o600});
  }
  runner.mint = mintKey.publicKey;
  const rent = await runner.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const clientToken = getAssociatedTokenAddressSync(runner.mint, runner.keys.client.publicKey);
  const agentToken = getAssociatedTokenAddressSync(runner.mint, runner.keys.agent.publicKey);
  const result: Array<{instruction: string; signature: string}> = [];
  const mint = await runner.transact('setup:mint', () => [
    SystemProgram.createAccount({fromPubkey: runner.keys.admin.publicKey, newAccountPubkey: mintKey.publicKey,
      lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID}),
    createInitializeMint2Instruction(mintKey.publicKey, 6, runner.keys.mintAuthority.publicKey, null),
    createAssociatedTokenAccountIdempotentInstruction(runner.keys.admin.publicKey, clientToken, runner.keys.client.publicKey, mintKey.publicKey),
    createAssociatedTokenAccountIdempotentInstruction(runner.keys.admin.publicKey, agentToken, runner.keys.agent.publicKey, mintKey.publicKey),
    createMintToInstruction(mintKey.publicKey, clientToken, runner.keys.mintAuthority.publicKey, 100_000_000n),
  ], [mintKey, runner.keys.mintAuthority]);
  result.push({instruction: 'local_dUSDC_mint_and_accounts', signature: mint.signature});
  const initialization = await runner.instruction('setup:initialize_config', 'initialize_config', configPda()[0], runner.keys.upgradeAuthority,
    {admin: runner.keys.admin.publicKey, validator: runner.keys.validator.publicKey});
  result.push({instruction: 'initialize_config', signature: initialization.signature});
  const update = await runner.instruction('setup:update_config', 'update_config', configPda()[0], runner.keys.admin,
    {validator: runner.keys.validator.publicKey, min_dispute_window: 60n, max_amount: 100_000_000n, paused: false});
  result.push({instruction: 'update_config', signature: update.signature});
  return result;
}

async function childCommand(command: string, argument: string, fault?: string): Promise<{code: number; output: string}> {
  const env: NodeJS.ProcessEnv = {...process.env, MULE_TEST_MODE: '1'};
  if (fault) env.MULE_TEST_FAULT = fault;
  else delete env.MULE_TEST_FAULT;
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('packages/runner/src/cli.ts'), command, argument],
      {env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.on('error', reject);
    child.on('close', code => resolveResult({code: code ?? 1, output}));
  });
}
async function checkedValidation(runner: RpcRunner, store: LocalContentStore, row: Evidence): Promise<ValidationResult> {
  const address = new PublicKey(row.address);
  const fault = row.number === 1 ? 'after-report' : row.number === 2 ? 'after-verdict' : undefined;
  if (!fault || row.idempotence) return validateMission(runner, store, address);
  const interrupted = await childCommand('validate', row.address, fault);
  assert.equal(interrupted.code, 42, 'Fault process must exit at the requested checkpoint: ' + interrupted.output);
  const previous = runner.journal.read<ValidationResult>('validation:' + row.address);
  assert(previous?.reportHash);
  const before = await runner.verdictReceipts(address);
  assert.equal(before.length, fault === 'after-report' ? 0 : 1);
  const crashedTransaction = runner.journal.read<TransactionRecord>('tx:' + row.address + ':record_verdict');
  assert.equal(crashedTransaction?.state ?? 'absent', fault === 'after-report' ? 'absent' : 'signed');
  const resumed = await childCommand('validate', row.address);
  assert.equal(resumed.code, 0, 'Restarted validation failed: ' + resumed.output);
  const result = runner.journal.read<ValidationResult>('validation:' + row.address);
  assert(result);
  assert.equal(result.reportHash, previous.reportHash);
  const after = await runner.verdictReceipts(address);
  assert.equal(after.length, 1);
  const transactions = await runner.connection.getSignaturesForAddress(address, {limit: 100});
  assert(transactions.every(transaction => transaction.err === null), 'No rejected duplicate transaction is allowed');
  assert.equal(transactions.length, 4, 'Exactly create, accept, submit and one verdict must exist');
  row.idempotence = {fault, firstExitCode: interrupted.code, verdictsBeforeRestart: before.length, verdictsAfterRestart: after.length,
    originalReportHash: previous.reportHash, recoveredReportHash: result.reportHash, sameReportHash: true,
    chainTransactionCount: transactions.length, uniqueSignatures: new Set(transactions.map(transaction => transaction.signature)).size,
    transactionJournalAtCrash: crashedTransaction?.state ?? 'absent',
    transactionJournalAfterRestart: runner.journal.read<TransactionRecord>('tx:' + row.address + ':record_verdict')?.state ?? 'absent'};
  assert.equal(row.idempotence.transactionJournalAfterRestart, 'confirmed');
  return result;
}

async function closeEvidence(runner: RpcRunner, row: Evidence, instruction: string, receipt: Receipt): Promise<void> {
  remember(row, instruction, receipt);
  row.terminalInstruction = instruction;
  assert(row.beforeSettlement, 'Retained settlement intent is required');
  const snapshots = await runner.settlementBalances(receipt.signature, row.beforeSettlement);
  row.beforeSettlement = snapshots.before;
  row.afterSettlement = snapshots.after;
  const address = new PublicKey(row.address);
  const [mission, vault] = await Promise.all([runner.connection.getAccountInfo(address), runner.connection.getAccountInfo(vaultPda(address)[0])]);
  row.missionClosed = mission === null; row.vaultClosed = vault === null;
  assert(row.missionClosed && row.vaultClosed, 'Both escrow accounts must close');
  const terminal = receipt.events.filter(event => ['missionsettled', 'missionrefunded'].includes(event.name.replaceAll('_', '').toLowerCase()));
  assert.equal(terminal.length, 1, 'Exactly one terminal event required');
  const event = terminal[0]!;
  assert.equal(String(event.data.mission), row.address);
  assert.equal(String(event.data.amount), row.amount);
  const state = Object.keys(event.data.status as object)[0]?.toLowerCase();
  assert(state === 'settled' || state === 'refunded');
  row.finalStatus = state; row.finalEvent = event.name;
  const shouldPay = row.mode === 'honest' && !row.dispute;
  assert.equal(state, shouldPay ? 'settled' : 'refunded');
  row.recipient = (shouldPay ? runner.keys.agent : runner.keys.client).publicKey.toBase58();
  assert(row.beforeSettlement && row.afterCreate && row.beforeCreate && row.rentExpected);
  const before = row.beforeSettlement, after = row.afterSettlement;
  assert.equal(BigInt(after.client) - BigInt(before.client), shouldPay ? 0n : BigInt(row.amount));
  assert.equal(BigInt(after.agent) - BigInt(before.agent), shouldPay ? BigInt(row.amount) : 0n);
  row.rentReturned = (BigInt(after.clientLamports) - BigInt(before.clientLamports)).toString();
  assert.equal(row.rentReturned, row.rentExpected, 'Client receives the complete mission+vault rent; admin pays fees');
  const signatures = await runner.connection.getSignaturesForAddress(address, {limit: 100});
  assert(signatures.every(signature => signature.err === null));
  assert.equal(signatures.length, row.transactions.length, 'No duplicate or unexpected transaction in mission history');
  assert.equal(new Set(signatures.map(signature => signature.signature)).size, row.transactions.length);
}

/** Recover an interrupted reservation without ever releasing or reusing that identity. */
export async function createMission(runner:RpcRunner,report:CampaignReport,row:Evidence):Promise<void> {
  const save=():void=>runner.journal.write('campaign',report);
  for(;;) {
    const address=new PublicKey(row.address);
    const operation=row.address+':create_mission';
    const signed=runner.journal.read<TransactionRecord>('tx:'+operation);
    if((!signed && runner.isReserved(BigInt(row.missionId))) || signed?.state==='expired-not-landed') {
      const account=await runner.connection.getAccountInfo(address,'finalized');
      const history=await runner.missionHistory(address,'finalized');
      if(account || history.length) {
        // A retained chain creation is authoritative even when an earlier local record is missing.
        const creation=history.find(entry=>entry.receipt.events.some(event=>event.name.replaceAll('_','').toLowerCase()==='missioncreated'));
        assert(creation,'Reserved identity has chain evidence without a creation event; retain state and retry');
        remember(row,'create_mission',creation.receipt);
        break;
      }
      const proof=signed?.state==='expired-not-landed'?signed.expiredAttempts?.at(-1):undefined;
      if(signed?.state==='expired-not-landed')assert(proof&&proof.finalizedHeight>proof.lastValidBlockHeight,'Missing finalized non-execution proof');
      const consumed={id:row.missionId,address:row.address,status:'consumed-never-created' as const,signatureCount:history.length,
        ...(proof?{expiredSignature:proof.signature,lastValidBlockHeight:proof.lastValidBlockHeight,finalizedHeight:proof.finalizedHeight}:{})};
      runner.journal.write('creation:'+row.address,consumed);
      row.consumedIds=[...(row.consumedIds??[]),consumed];
      const ids=report.missions.flatMap(mission=>[BigInt(mission.missionId),...(mission.consumedIds??[]).map(item=>BigInt(item.id))]);
      const next=ids.reduce((maximum,id)=>id>maximum?id:maximum,0n)+1n;
      row.missionId=next.toString();
      row.address=missionPda(runner.keys.client.publicKey,next)[0].toBase58();
      delete row.beforeCreate;delete row.afterCreate;delete row.rentExpected;
      save();
      continue;
    }
    if(!row.beforeCreate) {
      row.beforeCreate=await runner.balances();
      row.deadline=String(await runner.now()+(row.number>=9?10n:600n));
      save();
    }
    runner.journal.write('creation:'+row.address,{id:row.missionId,address:row.address,status:'planned'});
    let creation:Receipt;
    try {
      creation=await runner.instruction(operation,'create_mission',address,runner.keys.client,
        {mission_id:BigInt(row.missionId),amount:BigInt(row.amount),criteria_hash:hashBytes(row.criteriaHash),criteria_uri:row.criteriaUri,
          deadline:BigInt(row.deadline),dispute_window:60n,designated_agent:row.designated?runner.keys.agent.publicKey:null});
    } catch(error) {
      if(error instanceof CreationExpiredWithoutExecution)continue;
      throw error;
    }
    remember(row,'create_mission',creation);
    runner.journal.write('creation:'+row.address,{id:row.missionId,address:row.address,status:'created',signature:creation.signature});
    break;
  }
  if(!row.afterCreate) {
    assert(row.beforeCreate);
    row.afterCreate=await runner.balances();
    assert.equal(BigInt(row.beforeCreate.client)-BigInt(row.afterCreate.client),BigInt(row.amount));
    assert.equal(row.beforeCreate.agent,row.afterCreate.agent);
    const address=new PublicKey(row.address);
    const accounts=await runner.connection.getMultipleAccountsInfo([address,vaultPda(address)[0]]);
    assert(accounts[0]&&accounts[1]);
    row.rentExpected=String(accounts[0].lamports+accounts[1].lamports);
    assert.equal(BigInt(row.beforeCreate.clientLamports)-BigInt(row.afterCreate.clientLamports),BigInt(row.rentExpected));
  }
  save();
}

/** Terminal events and transaction metadata reconstruct a manifest interrupted after on-chain closure. */
export async function reconcileClosed(runner:RpcRunner,report:CampaignReport,row:Evidence):Promise<boolean> {
  if(row.finalStatus)return true;
  const address=new PublicKey(row.address);
  if(await runner.mission(address))return false;
  const history=await runner.missionHistory(address);
  const terminal=history.filter(entry=>entry.receipt.events.some(event=>
    ['missionsettled','missionrefunded','missioncancelled'].includes(event.name.replaceAll('_','').toLowerCase())));
  if(!terminal.length)return false;
  assert.equal(terminal.length,1,'Exactly one terminal transaction is allowed');
  const settled=terminal[0]!;
  for(const entry of [...history].reverse())remember(row,entry.instruction,entry.receipt);
  await closeEvidence(runner,row,settled.instruction,settled.receipt);
  runner.journal.write('campaign',report);
  return true;
}

export async function settleMission(runner:RpcRunner,report:CampaignReport,row:Evidence):Promise<void> {
  if(await reconcileClosed(runner,report,row))return;
  if(!row.beforeSettlement) {
    row.beforeSettlement=await runner.balances();
    runner.journal.write('campaign',report);
  }
  const address=new PublicKey(row.address);
  if(row.dispute) {
    const receipt=await runner.instruction(row.address+':resolve_dispute','resolve_dispute',address,runner.keys.admin,{pay_agent:false});
    await closeEvidence(runner,row,'resolve_dispute',receipt);
  } else {
    const results=await sweep(runner,[address]);assert.equal(results.length,1,'The mission must be due for settlement');
    const result=results[0]!;
    await closeEvidence(runner,row,result.instruction,result);
  }
  runner.journal.write('campaign',report);
}

export async function sweepCampaign(runner:RpcRunner,report:CampaignReport):Promise<Array<{mission:string;instruction:string;signature:string}>> {
  for(const row of report.missions)if(!row.finalStatus)await reconcileClosed(runner,report,row);
  const rows=report.missions.filter(row=>!row.finalStatus);
  return sweep({
    now:()=>runner.now(),mission:address=>runner.mission(address),
    execute:async(address,instruction)=>{
      const row=rows.find(entry=>entry.address===address.toBase58());assert(row);
      row.beforeSettlement=await runner.balances();runner.journal.write('campaign',report);
      const receipt=await runner.execute(address,instruction);
      await closeEvidence(runner,row,instruction,receipt);
      runner.journal.write('campaign',report);
      return receipt;
    },
  },rows.map(row=>new PublicKey(row.address)));
}

async function checkedCreation(runner:RpcRunner,report:CampaignReport,row:Evidence):Promise<void> {
  if(row.number!==3 || row.reserveRecovery || runner.isReserved(BigInt(row.missionId)) || row.transactions.some(entry=>entry.instruction==='create_mission')) {
    await createMission(runner,report,row);return;
  }
  const consumedId=row.missionId,consumedAddress=row.address;
  const interruption=await childCommand('create',String(row.number),'after-reserve');
  assert.equal(interruption.code,42,'after-reserve process must stop after durable ID reservation: '+interruption.output);
  assert(runner.isReserved(BigInt(consumedId)));
  assert.equal(runner.journal.read('tx:'+consumedAddress+':create_mission'),null,'No signed transaction may exist at reservation crash');
  assert.equal(await runner.mission(new PublicKey(consumedAddress)),null);
  const before=await runner.connection.getSignaturesForAddress(new PublicKey(consumedAddress));
  assert.equal(before.length,0);
  const resumed=await childCommand('create',String(row.number));
  assert.equal(resumed.code,0,'Reservation restart failed: '+resumed.output);
  const saved=runner.journal.read<CampaignReport>('campaign');assert(saved);
  const recovered=saved.missions.find(entry=>entry.number===row.number);assert(recovered);
  Object.assign(row,recovered);
  const after=await runner.connection.getSignaturesForAddress(new PublicKey(consumedAddress));
  assert.equal(after.length,0);
  assert.notEqual(row.missionId,consumedId);
  assert(row.consumedIds?.some(item=>item.id===consumedId&&item.status==='consumed-never-created'));
  row.reserveRecovery={fault:'after-reserve',firstExitCode:interruption.code,consumedId,consumedAddress,
    replacementId:row.missionId,chainSignaturesBefore:before.length,chainSignaturesAfter:after.length,neverReused:true};
  runner.journal.write('campaign',report);
}

async function checkedSettlement(runner:RpcRunner,report:CampaignReport,row:Evidence):Promise<void> {
  if(row.number!==4 || row.closeRecovery || row.finalStatus) {await settleMission(runner,report,row);return;}
  const interruption=await childCommand('settle',String(row.number),'after-close');
  assert.equal(interruption.code,42,'after-close process must stop before manifest completion: '+interruption.output);
  const crashed=runner.journal.read<CampaignReport>('campaign')?.missions.find(entry=>entry.number===row.number);assert(crashed);
  assert.equal(crashed.finalStatus,undefined);
  const address=new PublicKey(row.address);
  assert.equal(await runner.mission(address),null);
  assert.equal(await runner.connection.getAccountInfo(vaultPda(address)[0]),null);
  const history=await runner.missionHistory(address);
  const terminal=history.filter(entry=>entry.receipt.events.some(event=>['missionsettled','missionrefunded'].includes(event.name.replaceAll('_','').toLowerCase())));
  assert.equal(terminal.length,1);
  const signature=terminal[0]!.receipt.signature;
  const resumed=await childCommand('settle',String(row.number));
  assert.equal(resumed.code,0,'Closure restart failed: '+resumed.output);
  const recovered=runner.journal.read<CampaignReport>('campaign')?.missions.find(entry=>entry.number===row.number);assert(recovered);
  Object.assign(row,recovered);
  const after=await runner.missionHistory(address);
  assert.equal(after.length,history.length,'Reconciliation must not broadcast a duplicate transaction');
  assert.equal(row.transactions.find(entry=>entry.instruction===row.terminalInstruction)?.signature,signature);
  row.closeRecovery={fault:'after-close',firstExitCode:interruption.code,manifestStateAtCrash:'pending',terminalSignature:signature,
    chainSignaturesBefore:history.length,chainSignaturesAfter:after.length,missionClosed:row.missionClosed===true,vaultClosed:row.vaultClosed===true};
  runner.journal.write('campaign',report);
}

export async function campaign(runner: RpcRunner, store: LocalContentStore, runDirectory: string, runId: string): Promise<CampaignReport> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) throw new Error('Invalid public run ID');
  await runner.bindChain();
  const setupReceipts = await setup(runner);
  assert(runner.mint);
  let report = runner.journal.read<CampaignReport>('campaign');
  if (!report) {
    const date = new Date().toISOString().slice(0, 10);
    report = {execution: 'solana-test-validator', agent: 'agent de référence scripté', runId, date,
      genesis: await runner.connection.getGenesisHash(), mint: runner.mint.toBase58(), program: runner.sdk.programId.toBase58(),
      minDisputeWindow: 60, setup: setupReceipts, roles: Object.fromEntries(Object.entries(runner.keys).map(([name, key]) => [name, key.publicKey.toBase58()])),
      missions: [], simulatedOnly: ['refund_stale: deadline + 7 days (LiteSVM advanced Clock)', 'Disputed finalize: disputed_at + 14 days (LiteSVM advanced Clock)'],
      checks: {total: 10, paid: 4, refunded: 6, dishonestRefunded: 3}};
    const cases: Array<{model: Model; mode: Mode}> = [
      {model:'invoice.v1',mode:'honest'}, {model:'invoice.v1',mode:'dishonest'},
      {model:'contract.v1',mode:'honest'}, {model:'contract.v1',mode:'dishonest'},
      {model:'address.v1',mode:'honest'}, {model:'address.v1',mode:'dishonest'},
      {model:'invoice.v1',mode:'honest'}, {model:'invoice.v1',mode:'honest'},
      {model:'invoice.v1',mode:'never-accepted'}, {model:'invoice.v1',mode:'never-delivered'},
    ];
    for (const [index, example] of cases.entries()) {
      const criteria = store.put(loadFixture(example.model).criteria);
      report.missions.push({number:index+1, missionId:String(index+1), ...example, designated: index===6, dispute:index===7,
        address:missionPda(runner.keys.client.publicKey,BigInt(index+1))[0].toBase58(), amount:'5000000',
        criteriaHash:criteria.hash,criteriaUri:criteria.uri,deadline:'0',transactions:[]});
    }
    runner.journal.write('campaign', report);
  }
  assert.equal(report.runId, runId);
  const save = ():void => runner.journal.write('campaign', report);
  for (const row of report.missions) {
    if (row.finalStatus) continue;
    if (await reconcileClosed(runner,report,row)) continue;
    await checkedCreation(runner,report,row);
    const address = new PublicKey(row.address);
    if (row.number===9) { row.validatorMessage='Not accepted; expiry refund'; save(); continue; }
    remember(row,'accept_mission',await runner.instruction(row.address+':accept_mission','accept_mission',address,runner.keys.agent));
    if (row.designated) {
      const accepted = await runner.mission(address);
      assert(accepted);
      assert(accepted.designatedAgent?.equals(runner.keys.agent.publicKey));
      assert(accepted.agent?.equals(runner.keys.agent.publicKey), 'Designated agent must be the accepted party');
    }
    if (row.number===10) { row.validatorMessage='Accepted, no delivery; expiry refund'; save(); continue; }
    if (!row.deliveryHash) {
      const delivery = store.put(await createDelivery(row.model,row.mode as 'honest'|'dishonest',loadFixture(row.model).input));
      row.deliveryHash=delivery.hash;row.deliveryUri=delivery.uri;save();
    }
    assert(row.deliveryUri);
    remember(row,'submit_delivery',await runner.instruction(row.address+':submit_delivery','submit_delivery',address,runner.keys.agent,
      {delivery_hash:hashBytes(row.deliveryHash),delivery_uri:row.deliveryUri}));
    const validation = await checkedValidation(runner,store,row);
    row.reportHash=validation.reportHash;row.reportUri=validation.reportUri;row.validatorMessage=validation.message;row.pass=validation.passed;
    remember(row,'record_verdict',{signature:validation.signature,events:[]});
    assert.equal(validation.passed,row.mode==='honest');
    if(row.mode==='dishonest') {
      const messages:Record<Model,string>={'invoice.v1':'5/6 · MISSING: total_amount','contract.v1':'4/5 · MISSING: governing_law','address.v1':'11/12 · INVALID POSTCODE, ROW 7'};
      assert.equal(validation.message,messages[row.model]);
    }
    save();
    if(row.dispute) {
      remember(row,'open_dispute',await runner.instruction(row.address+':open_dispute','open_dispute',address,runner.keys.client));
      assert.equal(missionStatus((await runner.mission(address))!),'disputed');
      await settleMission(runner,report,row);save();
    }
  }
  // All normal verdict windows overlap. Wait on the chain Clock once, then sweep every due mission.
  let due=0n;
  for(const row of report.missions.filter(row=>!row.finalStatus)) {
    const mission=await runner.mission(new PublicKey(row.address));assert(mission);
    const timestamp=mission.verdictAt===null?bnToBigInt(mission.deadline):bnToBigInt(mission.verdictAt)+bnToBigInt(mission.disputeWindow);
    if(timestamp>due)due=timestamp;
  }
  const waitStarted=Date.now();
  while(await runner.now()<due) {
    if(Date.now()-waitStarted>180_000)throw new Error('Local Clock did not reach the settlement boundary');
    await pause(500);
  }
  for(const row of report.missions.filter(row=>!row.finalStatus)) {
    await checkedSettlement(runner,report,row);
  }
  for(const consumed of report.missions.flatMap(row=>row.consumedIds??[])) {
    assert(runner.isReserved(BigInt(consumed.id)));
    assert.equal(await runner.mission(new PublicKey(consumed.address)),null);
    assert.equal((await runner.connection.getSignaturesForAddress(new PublicKey(consumed.address))).length,0,'Consumed identity must never appear on-chain');
  }
  assert.equal(report.missions.length,10);
  assert.equal(report.missions.filter(row=>row.finalStatus==='settled').length,4);
  assert.equal(report.missions.filter(row=>row.finalStatus==='refunded').length,6);
  assert.equal(report.missions.filter(row=>row.mode==='dishonest'&&row.finalStatus==='refunded').length,3);
  mkdirSync(runDirectory,{recursive:true});
  const base=join(runDirectory,'local-'+report.date+'-'+runId);
  durableJson(base+'.json',report);
  writeFileSync(base+'.md',renderReport(report),'utf8');
  return report;
}

export function renderReport(report:CampaignReport):string {
  const lines=[
    '# MULE · Local campaign '+report.date+' · '+report.runId,
    '',
    'Execution: **solana-test-validator**. Agent: **agent de référence scripté**. Local test dUSDC: 6 decimals; amounts below are raw units. Admin pays every transaction fee. No AI API, no deployment, no public-chain transaction.',
    '',
    'All '+report.missions.length+' missions passed their assertions: 4 paid, 6 refunded, including all 3 dishonest deliveries. Mission 8 explicitly resolves the Passed dispute in favour of the client.',
    '',
    '| # | Model | Mode | Validator message | Outcome / recipient | Client tokens: before create → after create; before settle → after settle | Agent tokens: before create → after create; before settle → after settle | Rent expected / returned (lamports) | Closed mission / vault |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for(const row of report.missions) {
    const client=[row.beforeCreate?.client,row.afterCreate?.client,row.beforeSettlement?.client,row.afterSettlement?.client];
    const agent=[row.beforeCreate?.agent,row.afterCreate?.agent,row.beforeSettlement?.agent,row.afterSettlement?.agent];
    lines.push('| '+[row.number,row.model,row.mode+(row.designated?' (designated)':'')+(row.dispute?' (dispute)':''),row.validatorMessage,
      row.finalStatus+' / '+row.recipient,client[0]+' → '+client[1]+'; '+client[2]+' → '+client[3],
      agent[0]+' → '+agent[1]+'; '+agent[2]+' → '+agent[3],row.rentExpected+' / '+row.rentReturned,
      row.missionClosed+' / '+row.vaultClosed].join(' | ')+' |');
  }
  lines.push('','Escrow windows overlap, so balances are captured around each creation and each settlement separately. The JSON report includes all four client SOL balances and every signature. Each escrow deduction, terminal transfer and complete rent return is asserted independently.','',
    '## Transaction and content evidence','');
  for(const row of report.missions) {
    lines.push('### Mission '+row.number+' · '+row.address,'',
      '- Criteria: ['+row.criteriaHash+']('+row.criteriaUri+')');
    if(row.deliveryUri)lines.push('- Delivery: ['+row.deliveryHash+']('+row.deliveryUri+')');
    if(row.reportUri)lines.push('- Report: ['+row.reportHash+']('+row.reportUri+')');
    lines.push('- Terminal: '+row.terminalInstruction+' / '+row.finalEvent+' / '+row.finalStatus);
    for(const tx of row.transactions)lines.push('- '+tx.instruction+': '+tx.signature);
    if(row.idempotence)lines.push('- Restart evidence: '+JSON.stringify(row.idempotence));
    if(row.reserveRecovery)lines.push('- Reservation recovery: '+JSON.stringify(row.reserveRecovery));
    if(row.closeRecovery)lines.push('- Closure recovery: '+JSON.stringify(row.closeRecovery));
    if(row.consumedIds?.length)lines.push('- Consumed IDs (never created): '+JSON.stringify(row.consumedIds));
    lines.push('');
  }
  lines.push('## Scope of execution','','The ten missions above used the actual local RPC ledger and real SBF instructions. The command sweep settled all due normal verdicts and both expiry cases.',
    'The seven-day stale refund and fourteen-day dispute fallback are covered separately by the same sweep function executing real instructions in LiteSVM with an advanced Clock. No fourteen-day wait is claimed on the local RPC network.',
    'The local ledger is ephemeral: these signatures are evidence of the recorded local run, not links to a public explorer. Content URI publication on main occurs only if the owner merges this PR. Local reads use the rehashed files in data/ and never fetch those URLs.','');
  return lines.join('\n');
}
