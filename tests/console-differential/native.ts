import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LiteSVM, FailedTransactionMetadata, type TransactionMetadata } from 'litesvm';
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { AccountLayout, ACCOUNT_SIZE, MINT_SIZE, createInitializeMint2Instruction,
  createInitializeAccount3Instruction, createMintToInstruction } from '@solana/spl-token';
import { MuleClient, PROGRAM_ID, TOKEN_PROGRAM_ID, UPGRADEABLE_LOADER_ID, configPda, missionPda,
  vaultPda, programDataPda, missionStatus, InMemoryMissionIdHistory, bnToBigInt, BN,
  type Idl, type InstructionName } from '../../packages/sdk/src/index.js';
import type { EscrowSnapshot, Role } from '../../packages/console-core/src/index.js';

/** The model is never used to mutate this world. Only program-loader setup, clock
 * and in-memory SOL funding are fixtures; all MULE and SPL transitions execute SBF. */
export class NativeMission {
  readonly svm = new LiteSVM();
  readonly payer = Keypair.generate();
  readonly deployer = Keypair.generate();
  readonly actors: Record<Role, Keypair> = {
    client: Keypair.generate(), agent: Keypair.generate(),
    validator: Keypair.generate(), outsider: Keypair.generate(),
  };
  readonly sdk = new MuleClient(JSON.parse(readFileSync('target/idl/mule_escrow.json', 'utf8')) as Idl,
    PROGRAM_ID, new InMemoryMissionIdHistory());
  readonly mission = missionPda(this.actors.client.publicKey, 1n)[0];
  readonly vault = vaultPda(this.mission)[0];
  readonly mint: PublicKey;
  readonly clientToken: PublicKey;
  readonly agentToken: PublicKey;
  private terminal: EscrowSnapshot | undefined;

  constructor(now: bigint, clientBalance: bigint, agentBalance: bigint) {
    this.svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/mule_escrow.so');
    this.time(now);
    for (const key of [this.payer, this.deployer, ...Object.values(this.actors)]) {
      assert(!(this.svm.airdrop(key.publicKey, 10_000_000_000n) instanceof FailedTransactionMetadata));
    }
    const loaded = this.svm.getAccount(programDataPda()[0]);
    assert(loaded && loaded.owner.equals(UPGRADEABLE_LOADER_ID) && loaded.data.length > 45);
    const data = Buffer.from(loaded.data);
    data.writeUInt32LE(3); data.writeBigUInt64LE(0n, 4); data[12] = 1;
    this.deployer.publicKey.toBuffer().copy(data, 13);
    this.svm.setAccount(programDataPda()[0], { data, executable: false,
      owner: UPGRADEABLE_LOADER_ID, lamports: loaded.lamports });
    const mint = Keypair.generate(); this.mint = mint.publicKey;
    this.send([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: this.mint,
        lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
        space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(this.mint, 6, this.deployer.publicKey, null),
    ], [mint]);
    this.clientToken = this.newToken(this.actors.client.publicKey);
    this.agentToken = this.newToken(this.actors.agent.publicKey);
    this.send([
      createMintToInstruction(this.mint, this.clientToken, this.deployer.publicKey, clientBalance),
      createMintToInstruction(this.mint, this.agentToken, this.deployer.publicKey, agentBalance),
    ], [this.deployer]);
    this.send([this.sdk.instruction('initialize_config', this.accounts(this.deployer), {
      admin: this.deployer.publicKey, validator: this.actors.validator.publicKey,
    })], [this.deployer]);
    this.send([this.sdk.instruction('update_config', this.accounts(this.deployer), {
      validator: this.actors.validator.publicKey, min_dispute_window: 60n,
      max_amount: 100_000_000n, paused: false,
    })], [this.deployer]);
  }
  time(now: bigint): void {
    const clock = this.svm.getClock(); clock.unixTimestamp = now; this.svm.setClock(clock);
  }
  private raw(instructions: TransactionInstruction[], signers: Keypair[]) {
    this.svm.expireBlockhash();
    const transaction = new Transaction({ feePayer: this.payer.publicKey,
      recentBlockhash: this.svm.latestBlockhash() }).add(...instructions);
    transaction.sign(...new Map([this.payer, ...signers].map(key => [key.publicKey.toBase58(), key])).values());
    return this.svm.sendTransaction(transaction);
  }
  private send(instructions: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const result = this.raw(instructions, signers);
    if (result instanceof FailedTransactionMetadata) assert.fail(result.meta().logs().join('\n'));
    return result;
  }
  private newToken(owner: PublicKey): PublicKey {
    const key = Keypair.generate();
    this.send([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: key.publicKey,
        lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
        space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeAccount3Instruction(key.publicKey, this.mint, owner),
    ], [key]);
    return key.publicKey;
  }
  private accounts(signer: Keypair): Record<string, PublicKey> {
    return { deployer: signer.publicKey, admin: signer.publicKey, actor: signer.publicKey,
      validator: signer.publicKey, caller: signer.publicKey, config: configPda()[0],
      program_data: programDataPda()[0], mint: this.mint, client: this.actors.client.publicKey,
      mission: this.mission, vault: this.vault, client_token: this.clientToken,
      agent_token: this.agentToken, token_program: TOKEN_PROGRAM_ID, system_program: SystemProgram.programId };
  }
  absent(address: PublicKey): boolean {
    const account = this.svm.getAccount(address);
    return account === null || (account.lamports === 0 && account.data.length === 0);
  }
  balance(address: PublicKey): bigint {
    const account = this.svm.getAccount(address);
    assert(account && account.data.length === ACCOUNT_SIZE && account.owner.equals(TOKEN_PROGRAM_ID));
    return AccountLayout.decode(Buffer.from(account.data)).amount;
  }
  state() {
    const account = this.svm.getAccount(this.mission); assert(account && account.data.length > 0);
    return this.sdk.decodeMission(Buffer.from(account.data));
  }
  private actor(address: PublicKey | null): Role | null {
    if (!address) return null;
    const entry = Object.entries(this.actors).find(([, key]) => address.equals(key.publicKey));
    assert(entry, 'Unknown on-chain role'); return entry[0] as Role;
  }
  snapshot(): EscrowSnapshot {
    const balances = { client: this.balance(this.clientToken), agent: this.balance(this.agentToken),
      vault: this.absent(this.vault) ? 0n : this.balance(this.vault) };
    if (this.absent(this.mission)) {
      return this.terminal ? { ...this.terminal, balances }
        : { status: 'absent', balances, agent: null, reportHash: null };
    }
    const mission = this.state();
    const status = missionStatus(mission);
    assert(status !== 'disputed' && status !== 'cancelled');
    return { status, balances, agent: this.actor(mission.agent),
      reportHash: mission.reportHash ? Buffer.from(mission.reportHash).toString('hex') : null };
  }
  call(name: InstructionName, actor: Role, args: Record<string, unknown> = {}) {
    const before = this.snapshot();
    const signer = this.actors[actor];
    const result = this.send([this.sdk.instruction(name, this.accounts(signer), args)], [signer]);
    const events = this.sdk.events(result.logs(), null);
    assert.equal(events.length, 1, 'Exactly one successful MULE event');
    const event = events[0]!;
    assert((event.data.mission as PublicKey).equals(this.mission), 'Correct event mission');
    const amount = bnToBigInt(event.data.amount as BN);
    const status = Object.keys(event.data.status as object)[0]!.toLowerCase();
    if (name === 'finalize') {
      assert(status === 'settled' || status === 'refunded');
      assert(this.absent(this.mission) && this.absent(this.vault), 'Both escrow accounts closed');
      // Closed accounts have no readable state. The final status comes from the
      // verified event; the hash/agent are explicitly retained from pre-close data.
      this.terminal = { ...before, status };
    }
    return { name: event.name, amount, status, data: event.data };
  }
  reject(name: InstructionName, actor: Role, args: Record<string, unknown>, error: string): void {
    const before = this.snapshot();
    const signer = this.actors[actor];
    const result = this.raw([this.sdk.instruction(name, this.accounts(signer), args)], [signer]);
    assert(result instanceof FailedTransactionMetadata, 'Expected on-chain rejection');
    assert(result.meta().logs().join('\n').includes('Error Code: ' + error + '.'), 'Named program error ' + error);
    assert.deepEqual(this.snapshot(), before, 'Rejected call must preserve state and SPL balances');
    assert.equal(this.sdk.events(result.meta().logs(), result.err()).length, 0);
  }
  rent(): bigint {
    return [this.mission, this.vault].reduce((sum, key) => sum + BigInt(this.svm.getAccount(key)?.lamports ?? 0), 0n);
  }
  clientLamports(): bigint { return BigInt(this.svm.getAccount(this.actors.client.publicKey)!.lamports); }
}
