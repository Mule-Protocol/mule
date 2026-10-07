import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction,
  type TransactionInstruction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MuleClient, PROGRAM_ID, TOKEN_PROGRAM_ID, BN, bnToBigInt, configPda, programDataPda, vaultPda,
  missionIdHistoryKey, type Idl, type InstructionName, type Mission } from '@mule/sdk';
import { FileMissionIdHistory } from '@mule/sdk/file-history';
import { Journal } from './journal.js';
import { testFault } from './faults.js';
import type { Receipt, SweepInstruction, SweepPort } from './sweep.js';

export interface LocalKeys { admin: Keypair; validator: Keypair; client: Keypair; agent: Keypair; mintAuthority: Keypair; upgradeAuthority: Keypair }
export interface RunnerOptions { rpcUrl: string; idlPath: string; keyDirectory: string; stateDirectory: string }
export interface TransactionRecord {
  operation: string; signature: string; bytes: string; blockhash: string; lastValidBlockHeight: number;
  state: 'signed' | 'confirmed' | 'expired-not-landed'; receipt?: Receipt;
  broadcastAttempted?: boolean; signedSlot?: number;
  expiredAttempts?: Array<{signature:string; lastValidBlockHeight:number; finalizedHeight:number; outcome:'expired-not-landed'}>;
}
/** A creation proven absent after finalized expiry must get a fresh identity and deadline. */
export class CreationExpiredWithoutExecution extends Error {
  constructor(readonly signature:string) { super('Creation expired without execution; consume this identity and allocate a fresh one: '+signature); }
}
function jsonEvent(value: unknown): unknown {
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return bnToBigInt(value).toString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonEvent);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonEvent(entry)]));
  return value;
}
export const pause = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

export class RpcRunner implements SweepPort {
  readonly connection: Connection;
  readonly keys: LocalKeys;
  readonly sdk: MuleClient;
  readonly journal: Journal;
  readonly history: FileMissionIdHistory;
  mint: PublicKey | undefined;
  constructor(readonly options: RunnerOptions) {
    const rpc = new URL(options.rpcUrl);
    if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('An HTTP(S) RPC URL is required');
    this.connection = new Connection(options.rpcUrl, { commitment: 'confirmed', confirmTransactionInitialTimeout: 30_000 });
    this.keys = Object.fromEntries(['admin', 'validator', 'client', 'agent', 'mintAuthority', 'upgradeAuthority'].map(name =>
      [name, Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(options.keyDirectory, name + '.json'), 'utf8')) as number[]))])) as unknown as LocalKeys;
    const identities = Object.values(this.keys).map(key => key.publicKey.toBase58());
    if (new Set(identities).size !== identities.length) throw new Error('Local role keys must be distinct');
    this.journal = new Journal(options.stateDirectory);
    this.history = new FileMissionIdHistory(join(options.stateDirectory, 'mission-ids'));
    this.sdk = new MuleClient(JSON.parse(readFileSync(options.idlPath, 'utf8')) as Idl, PROGRAM_ID, {
      reserve: key => {
        const reserved = this.history.reserve(key);
        if (reserved) testFault('after-reserve');
        return reserved;
      },
    });
  }
  isReserved(id: bigint): boolean {
    return this.history.isReserved(missionIdHistoryKey(this.sdk.programId, this.keys.client.publicKey, id));
  }
  async bindChain(): Promise<void> {
    const genesis = await this.connection.getGenesisHash();
    const old = this.journal.read<{genesis: string}>('chain');
    if (old && old.genesis !== genesis) throw new Error('Retained journal belongs to a different chain; do not reuse it');
    if (!old) this.journal.write('chain', {genesis});
    // The program is loaded into the isolated test ledger, never deployed by this client.
    const program = await this.connection.getAccountInfo(PROGRAM_ID);
    assert(program?.executable, 'Expected locally preloaded executable program');
  }
  async now(): Promise<bigint> {
    const clock = await this.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!clock || clock.data.length < 40) throw new Error('Chain Clock unavailable');
    return clock.data.readBigInt64LE(32);
  }
  async mission(address: PublicKey): Promise<Mission | null> {
    const account = await this.connection.getAccountInfo(address);
    if (!account) return null;
    if (!account.owner.equals(PROGRAM_ID)) throw new Error('Mission owner mismatch');
    return this.sdk.decodeMission(account.data);
  }
  accounts(address: PublicKey, signer: Keypair): Record<string, PublicKey> {
    if (!this.mint) throw new Error('Mint has not been configured');
    return { deployer: signer.publicKey, admin: signer.publicKey, actor: signer.publicKey,
      validator: signer.publicKey, caller: signer.publicKey, config: configPda()[0], program_data: programDataPda()[0],
      mint: this.mint, client: this.keys.client.publicKey, mission: address, vault: vaultPda(address)[0],
      client_token: getAssociatedTokenAddressSync(this.mint, this.keys.client.publicKey),
      agent_token: getAssociatedTokenAddressSync(this.mint, this.keys.agent.publicKey),
      token_program: TOKEN_PROGRAM_ID, system_program: SystemProgram.programId };
  }
  async balances(): Promise<{client: string; agent: string; clientLamports: string}> {
    if (!this.mint) throw new Error('Mint has not been configured');
    const [client, agent, lamports] = await Promise.all([
      getAccount(this.connection, getAssociatedTokenAddressSync(this.mint, this.keys.client.publicKey)),
      getAccount(this.connection, getAssociatedTokenAddressSync(this.mint, this.keys.agent.publicKey)),
      this.connection.getBalance(this.keys.client.publicKey),
    ]);
    return {client: client.amount.toString(), agent: agent.amount.toString(), clientLamports: String(lamports)};
  }
  async instruction(operation: string, name: InstructionName, address: PublicKey, signer: Keypair,
    args: Record<string, unknown> = {}): Promise<Receipt> {
    return this.transact(operation, () => [this.sdk.instruction(name, this.accounts(address, signer), args)], [signer]);
  }
  async execute(address: PublicKey, instruction: SweepInstruction): Promise<Receipt> {
    return this.instruction(address.toBase58() + ':' + instruction, instruction, address, this.keys.admin);
  }
  async receipt(signature: string): Promise<Receipt> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const transaction = await this.connection.getTransaction(signature, {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
      if (transaction?.meta) {
        if (transaction.meta.err !== null) throw new Error('Transaction failed: ' + signature + ' ' + JSON.stringify(transaction.meta.err));
        return {signature, events: this.sdk.events(transaction.meta.logMessages ?? [], transaction.meta.err)
          .map(event => ({name: event.name, data: jsonEvent(event.data) as Record<string, unknown>}))};
      }
      await pause(250);
    }
    throw new Error('Confirmed transaction details unavailable; retain journal and retry: ' + signature);
  }
  /** One broadcast attempt per signature. Unknown outcomes wait for finalized expiry before reconciliation. */
  async transact(operation: string, build: () => TransactionInstruction[], signers: Keypair[]): Promise<Receipt> {
    let record = this.journal.read<TransactionRecord>('tx:' + operation);
    if (record?.state === 'confirmed' && record.receipt) return record.receipt;
    if (record?.state === 'expired-not-landed') throw new CreationExpiredWithoutExecution(record.signature);
    if (!record) {
      const latest = await this.connection.getLatestBlockhash();
      const transaction = new Transaction({feePayer: this.keys.admin.publicKey, ...latest}).add(...build());
      const unique = new Map([this.keys.admin, ...signers].map(key => [key.publicKey.toBase58(), key]));
      transaction.sign(...unique.values());
      assert(transaction.signature);
      record = {operation, signature: bs58.encode(transaction.signature), bytes: transaction.serialize().toString('base64'),
        ...latest, state: 'signed', broadcastAttempted: false, signedSlot: await this.connection.getSlot('confirmed')};
      this.journal.write('tx:' + operation, record);
    }
    const started = Date.now();
    while (Date.now() - started < 300_000) {
      const bytes = Buffer.from(record.bytes, 'base64');
      const decoded = Transaction.from(bytes);
      assert(decoded.verifySignatures(), 'Corrupted signed-transaction journal');
      assert(decoded.signature && bs58.encode(decoded.signature) === record.signature, 'Signature journal mismatch');
      const status = (await this.connection.getSignatureStatuses([record.signature], {searchTransactionHistory: true})).value[0];
      if (status?.err) throw new Error('Transaction rejected: ' + record.signature + ' ' + JSON.stringify(status.err));
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        const receipt = await this.receipt(record.signature);
        if (operation.endsWith(':record_verdict')) testFault('after-verdict');
        record = {...record, state: 'confirmed', receipt};
        this.journal.write('tx:' + operation, record);
        if (['finalize', 'resolve_dispute', 'refund_expired', 'refund_stale', 'cancel_mission']
          .some(name => operation.endsWith(':' + name))) testFault('after-close');
        return receipt;
      }
      const finalizedHeight = await this.connection.getBlockHeight('finalized');
      if (finalizedHeight > record.lastValidBlockHeight) {
        const observed = await this.reconcileExpired(record, finalizedHeight);
        if (observed) {
          record = {...record, state: 'confirmed', receipt: observed};
          this.journal.write('tx:' + operation, record);
          return observed;
        }
        const expiredAttempts: NonNullable<TransactionRecord['expiredAttempts']> = [...(record.expiredAttempts ?? []), {signature: record.signature,
          lastValidBlockHeight: record.lastValidBlockHeight, finalizedHeight, outcome: 'expired-not-landed' as const}];
        if (operation.endsWith(':create_mission')) {
          // Its absolute delivery deadline may already be past. Preserve the consumed ID and let
          // the campaign allocate a new one through the normal SDK path with a fresh deadline.
          record = {...record, state:'expired-not-landed', expiredAttempts};
          this.journal.write('tx:' + operation, record);
          throw new CreationExpiredWithoutExecution(record.signature);
        }
        // Both finalized signature lookup and retained account history prove non-execution.
        // Non-creation instructions can retain their original arguments.
        const latest = await this.connection.getLatestBlockhash();
        decoded.recentBlockhash = latest.blockhash;
        decoded.lastValidBlockHeight = latest.lastValidBlockHeight;
        decoded.signatures = [];
        const unique = new Map([this.keys.admin, ...signers].map(key => [key.publicKey.toBase58(), key]));
        decoded.sign(...unique.values());
        assert(decoded.signature);
        record = {operation, signature: bs58.encode(decoded.signature), bytes: decoded.serialize().toString('base64'),
          ...latest, state: 'signed', broadcastAttempted: false, signedSlot: await this.connection.getSlot('confirmed'), expiredAttempts};
        this.journal.write('tx:' + operation, record);
        continue;
      }
      if (record.broadcastAttempted === false) {
        // Persist BEFORE send: a process killed between here and the RPC call waits for expiry on restart.
        record = {...record, broadcastAttempted: true};
        this.journal.write('tx:' + operation, record);
        try {
          const sent = await this.connection.sendRawTransaction(bytes, {skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed'});
          assert.equal(sent, record.signature);
        } catch (error) {
          if (error instanceof SendTransactionError) throw new Error(error.message + '\n' + (error.logs ?? []).join('\n'));
          // Transport error is ambiguous. Do not send these bytes again.
        }
      }
      await pause(250);
    }
    throw new Error('RPC has not provided a definitive chain outcome yet; retained state resumes automatically: ' + record.signature);
  }

  async reconcileExpired(record: TransactionRecord, finalizedHeight: number): Promise<Receipt | null> {
    assert(finalizedHeight > record.lastValidBlockHeight, 'Never reconcile absence before finalized blockhash expiry');
    const transaction = await this.connection.getTransaction(record.signature, {commitment: 'finalized', maxSupportedTransactionVersion: 0});
    if (transaction?.meta) {
      if (transaction.meta.err !== null) throw new Error('Expired transaction actually failed on-chain: ' + record.signature);
      return this.receipt(record.signature);
    }
    const status = (await this.connection.getSignatureStatuses([record.signature], {searchTransactionHistory: true})).value[0];
    if (status) throw new Error('RPC signature views disagree; preserve journal until they converge');
    assert(record.signedSlot !== undefined, 'A transaction without its recorded slot cannot prove retained history');
    const earliest = await this.connection.getFirstAvailableBlock();
    assert(earliest <= record.signedSlot, 'RPC ledger pruned required history; no replacement transaction is permitted');
    const [addressText, instruction] = record.operation.split(':');
    if (addressText && instruction && addressText !== 'setup') {
      const address = new PublicKey(addressText);
      // The finalized PDA and its full retained signature history are both consulted.
      const account = await this.connection.getAccountInfo(address, 'finalized');
      const history = await this.missionHistory(address, 'finalized');
      const exact = history.find(entry => entry.receipt.signature === record.signature);
      if (exact) return exact.receipt;
      const terminal = history.find(entry => entry.receipt.events.some(event =>
        ['missionsettled', 'missionrefunded', 'missioncancelled'].includes(event.name.replaceAll('_', '').toLowerCase())));
      if (terminal || (instruction === 'create_mission' && account !== null)) {
        throw new Error('Mission already transitioned under another signature; do not recreate it');
      }
    }
    return null;
  }

  async missionHistory(address: PublicKey, commitment: 'confirmed' | 'finalized' = 'confirmed'):
    Promise<Array<{instruction: string; receipt: Receipt}>> {
    const result: Array<{instruction: string; receipt: Receipt}> = [];
    let before: string | undefined;
    for (;;) {
      const signatures = await this.connection.getSignaturesForAddress(address, {limit: 1000, before}, commitment);
      for (const entry of signatures) {
        if (entry.err !== null) continue;
        const transaction = await this.connection.getTransaction(entry.signature, {commitment, maxSupportedTransactionVersion: 0});
        if (!transaction?.meta) throw new Error('RPC account history has not exposed transaction details yet');
        const keys = transaction.transaction.message.staticAccountKeys;
        const instructions = transaction.transaction.message.compiledInstructions;
        for (const instruction of instructions) {
          if (!keys[instruction.programIdIndex]?.equals(this.sdk.programId)) continue;
          const decoded = this.sdk.coder.instruction.decode(Buffer.from(instruction.data));
          if (!decoded) continue;
          const receipt = await this.receipt(entry.signature);
          if (receipt.events.some(event => String(event.data.mission) === address.toBase58())) {
            result.push({instruction: decoded.name, receipt});
          }
        }
      }
      if (signatures.length < 1000) return result;
      before = signatures.at(-1)!.signature;
    }
  }

  async settlementBalances(signature: string, fallback: {client:string;agent:string;clientLamports:string}):
    Promise<{before:typeof fallback;after:typeof fallback}> {
    assert(this.mint);
    const transaction = await this.connection.getTransaction(signature, {commitment:'confirmed',maxSupportedTransactionVersion:0});
    assert(transaction?.meta && transaction.meta.err === null, 'Missing successful settlement metadata');
    const keys=transaction.transaction.message.staticAccountKeys;
    const clientIndex=keys.findIndex(key=>key.equals(this.keys.client.publicKey));
    assert(clientIndex>=0);
    const tokenAmount=(owner:PublicKey, side:'preTokenBalances'|'postTokenBalances', missing:string):string=>{
      const address=getAssociatedTokenAddressSync(this.mint!,owner);
      const index=keys.findIndex(key=>key.equals(address));
      if(index<0)return missing; // Refund instructions do not include the unchanged agent token account.
      const balance=transaction.meta![side]?.find(entry=>entry.accountIndex===index);
      assert(balance,'Token balance metadata missing for settlement recipient');
      assert.equal(balance.mint,this.mint!.toBase58());
      return balance.uiTokenAmount.amount;
    };
    return {
      before:{client:tokenAmount(this.keys.client.publicKey,'preTokenBalances',fallback.client),
        agent:tokenAmount(this.keys.agent.publicKey,'preTokenBalances',fallback.agent),
        clientLamports:String(transaction.meta.preBalances[clientIndex])},
      after:{client:tokenAmount(this.keys.client.publicKey,'postTokenBalances',fallback.client),
        agent:tokenAmount(this.keys.agent.publicKey,'postTokenBalances',fallback.agent),
        clientLamports:String(transaction.meta.postBalances[clientIndex])},
    };
  }

  async verdictReceipts(address: PublicKey): Promise<Receipt[]> {
    const signatures = await this.connection.getSignaturesForAddress(address, {limit: 100});
    const receipts: Receipt[] = [];
    for (const status of signatures) {
      if (status.err !== null) continue;
      const receipt = await this.receipt(status.signature);
      if (receipt.events.some(event => event.name.replaceAll('_', '').toLowerCase() === 'verdictrecorded')) receipts.push(receipt);
    }
    return receipts;
  }
}
