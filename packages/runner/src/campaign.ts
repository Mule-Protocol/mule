import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { MINT_SIZE, createInitializeMint2Instruction, createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID, configPda, missionPda, missionStatus, vaultPda } from '@mule/sdk';
import { LocalContentStore, loadFixture } from '@mule/validator';
import { createDelivery } from '@mule/agent';
import { RpcRunner, pause, type TransactionRecord } from './rpc.js';
import { durableJson } from './journal.js';
import { sweep, type Receipt } from './sweep.js';
import { validateMission, type ValidationResult } from './validate.js';

type Model = 'invoice.v1' | 'contract.v1' | 'address.v1';
type Mode = 'honest' | 'dishonest' | 'never-accepted' | 'never-delivered';
type Balance = Awaited<ReturnType<RpcRunner['balances']>>;
interface Evidence {
  number: number; model: Model; mode: Mode; designated: boolean; dispute: boolean; address: string;
  amount: string; criteriaHash: string; criteriaUri: string; deliveryHash?: string; deliveryUri?: string;
  deadline: string; reportHash?: string; reportUri?: string; validatorMessage?: string; pass?: boolean;
  beforeCreate?: Balance; afterCreate?: Balance; beforeSettlement?: Balance; afterSettlement?: Balance;
  rentExpected?: string; rentReturned?: string; vaultClosed?: boolean; missionClosed?: boolean;
  finalStatus?: string; finalEvent?: string; recipient?: string; terminalInstruction?: string;
  transactions: Array<{instruction: string; signature: string}>;
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

async function childValidation(address: string, fault?: string): Promise<{code: number; output: string}> {
  const env: NodeJS.ProcessEnv = {...process.env, MULE_TEST_MODE: '1'};
  if (fault) env.MULE_TEST_FAULT = fault;
  else delete env.MULE_TEST_FAULT;
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('packages/runner/src/cli.ts'), 'validate', address],
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
  const interrupted = await childValidation(row.address, fault);
  assert.equal(interrupted.code, 42, 'Fault process must exit at the requested checkpoint: ' + interrupted.output);
  const previous = runner.journal.read<ValidationResult>('validation:' + row.address);
  assert(previous?.reportHash);
  const before = await runner.verdictReceipts(address);
  assert.equal(before.length, fault === 'after-report' ? 0 : 1);
  const crashedTransaction = runner.journal.read<TransactionRecord>('tx:' + row.address + ':record_verdict');
  assert.equal(crashedTransaction?.state ?? 'absent', fault === 'after-report' ? 'absent' : 'signed');
  const resumed = await childValidation(row.address);
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
  row.afterSettlement = await runner.balances();
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
      report.missions.push({number:index+1, ...example, designated: index===6, dispute:index===7,
        address:missionPda(runner.keys.client.publicKey,BigInt(index+1))[0].toBase58(), amount:'5000000',
        criteriaHash:criteria.hash,criteriaUri:criteria.uri,deadline:'0',transactions:[]});
    }
    runner.journal.write('campaign', report);
  }
  assert.equal(report.runId, runId);
  const save = ():void => runner.journal.write('campaign', report);
  for (const row of report.missions) {
    if (row.finalStatus) continue;
    const address = new PublicKey(row.address);
    if (!row.beforeCreate) { row.beforeCreate = await runner.balances(); row.deadline = String(await runner.now() + (row.number >= 9 ? 10n : 600n)); save(); }
    const creation = await runner.instruction(row.address + ':create_mission', 'create_mission', address, runner.keys.client,
      {mission_id:BigInt(row.number),amount:BigInt(row.amount),criteria_hash:hashBytes(row.criteriaHash),criteria_uri:row.criteriaUri,
        deadline:BigInt(row.deadline),dispute_window:60n,designated_agent:row.designated?runner.keys.agent.publicKey:null});
    remember(row,'create_mission',creation);
    if (!row.afterCreate) {
      row.afterCreate = await runner.balances();
      assert.equal(BigInt(row.beforeCreate.client)-BigInt(row.afterCreate.client),BigInt(row.amount));
      assert.equal(row.beforeCreate.agent,row.afterCreate.agent);
      const accounts = await runner.connection.getMultipleAccountsInfo([address,vaultPda(address)[0]]);
      assert(accounts[0] && accounts[1]);
      row.rentExpected = String(accounts[0].lamports + accounts[1].lamports);
      assert.equal(BigInt(row.beforeCreate.clientLamports)-BigInt(row.afterCreate.clientLamports),BigInt(row.rentExpected));
      save();
    }
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
      row.beforeSettlement=await runner.balances();save();
      const resolution=await runner.instruction(row.address+':resolve_dispute','resolve_dispute',address,runner.keys.admin,{pay_agent:false});
      await closeEvidence(runner,row,'resolve_dispute',resolution);save();
    }
  }
  // All normal verdict windows overlap. Wait on the chain Clock once, then sweep every due mission.
  let due=0n;
  for(const row of report.missions.filter(row=>!row.finalStatus)) {
    const mission=await runner.mission(new PublicKey(row.address));assert(mission);
    const timestamp=mission.verdictAt===null?BigInt(mission.deadline.toString()):BigInt(mission.verdictAt.toString())+BigInt(mission.disputeWindow.toString());
    if(timestamp>due)due=timestamp;
  }
  const waitStarted=Date.now();
  while(await runner.now()<due) {
    if(Date.now()-waitStarted>180_000)throw new Error('Local Clock did not reach the settlement boundary');
    await pause(500);
  }
  for(const row of report.missions.filter(row=>!row.finalStatus)) {
    row.beforeSettlement=await runner.balances();save();
    const results=await sweep(runner,[new PublicKey(row.address)]);assert.equal(results.length,1);
    const result=results[0]!;
    await closeEvidence(runner,row,result.instruction,result);save();
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
    lines.push('');
  }
  lines.push('## Scope of execution','','The ten missions above used the actual local RPC ledger and real SBF instructions. The command sweep settled all due normal verdicts and both expiry cases.',
    'The seven-day stale refund and fourteen-day dispute fallback are covered separately by the same sweep function executing real instructions in LiteSVM with an advanced Clock. No fourteen-day wait is claimed on the local RPC network.',
    'The local ledger is ephemeral: these signatures are evidence of the recorded local run, not links to a public explorer. Content URI publication on main occurs only if the owner merges this PR. Local reads use the rehashed files in data/ and never fetch those URLs.','');
  return lines.join('\n');
}
