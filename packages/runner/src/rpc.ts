import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction,
  type TransactionInstruction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MuleClient, PROGRAM_ID, TOKEN_PROGRAM_ID, BN, configPda, programDataPda, vaultPda,
  type Idl, type InstructionName, type Mission } from '@mule/sdk';
import { FileMissionIdHistory } from '@mule/sdk/file-history';
import { Journal } from './journal.js';
import { testFault } from './faults.js';
import type { Receipt, SweepInstruction, SweepPort } from './sweep.js';

export interface LocalKeys { admin: Keypair; validator: Keypair; client: Keypair; agent: Keypair; mintAuthority: Keypair; upgradeAuthority: Keypair }
export interface RunnerOptions { rpcUrl: string; idlPath: string; keyDirectory: string; stateDirectory: string }
export interface TransactionRecord {
  operation: string; signature: string; bytes: string; blockhash: string; lastValidBlockHeight: number;
  state: 'signed' | 'confirmed'; receipt?: Receipt;
}
function jsonEvent(value: unknown): unknown {
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return value.toString(10);
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
    this.sdk = new MuleClient(JSON.parse(readFileSync(options.idlPath, 'utf8')) as Idl, PROGRAM_ID,
      new FileMissionIdHistory(join(options.stateDirectory, 'mission-ids')));
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
  /** Persist signed bytes BEFORE broadcast. An ambiguous submission only ever resends those exact bytes. */
  async transact(operation: string, build: () => TransactionInstruction[], signers: Keypair[]): Promise<Receipt> {
    let record = this.journal.read<TransactionRecord>('tx:' + operation);
    if (record?.state === 'confirmed' && record.receipt) return record.receipt;
    if (!record) {
      const latest = await this.connection.getLatestBlockhash();
      const transaction = new Transaction({feePayer: this.keys.admin.publicKey, ...latest}).add(...build());
      const unique = new Map([this.keys.admin, ...signers].map(key => [key.publicKey.toBase58(), key]));
      transaction.sign(...unique.values());
      assert(transaction.signature);
      record = {operation, signature: bs58.encode(transaction.signature), bytes: transaction.serialize().toString('base64'),
        ...latest, state: 'signed'};
      this.journal.write('tx:' + operation, record);
    }
    const bytes = Buffer.from(record.bytes, 'base64');
    const decoded = Transaction.from(bytes);
    assert(decoded.verifySignatures(), 'Corrupted signed-transaction journal');
    assert(decoded.signature && bs58.encode(decoded.signature) === record.signature, 'Signature journal mismatch');
    let lastSend = 0;
    for (let attempt = 0; attempt < 240; attempt++) {
      const status = (await this.connection.getSignatureStatuses([record.signature], {searchTransactionHistory: true})).value[0];
      if (status?.err) throw new Error('Transaction rejected: ' + record.signature + ' ' + JSON.stringify(status.err));
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        const receipt = await this.receipt(record.signature);
        if (operation.endsWith(':record_verdict')) testFault('after-verdict');
        record = {...record, state: 'confirmed', receipt};
        this.journal.write('tx:' + operation, record);
        return receipt;
      }
      if (await this.connection.getBlockHeight() > record.lastValidBlockHeight) {
        // Never create a replacement transaction while outcome remains ambiguous.
        throw new Error('Signed transaction expired without a confirmed outcome; manual reconciliation required: ' + record.signature);
      }
      if (Date.now() - lastSend >= 2_000) {
        try {
          const sent = await this.connection.sendRawTransaction(bytes, {skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed'});
          assert.equal(sent, record.signature);
        } catch (error) {
          // A deterministic preflight failure means these bytes cannot land; expose its logs immediately.
          if (error instanceof SendTransactionError) throw new Error(error.message + '\n' + (error.logs ?? []).join('\n'));
          // An RPC transport failure can occur after acceptance: only recheck/resend the original bytes.
          if (attempt === 239) throw error;
        }
        lastSend = Date.now();
      }
      await pause(250);
    }
    throw new Error('Transaction outcome pending; retain journal and rerun: ' + record.signature);
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
