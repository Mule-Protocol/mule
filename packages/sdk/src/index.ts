import { BorshAccountsCoder, BorshCoder, BN, EventParser, type Idl } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { MissionIdAlreadyUsedError, type MissionIdHistory } from './history.js';
export { InMemoryMissionIdHistory, MissionIdAlreadyUsedError, type MissionIdHistory } from './history.js';

/** Test-only identity. There is no deployed MULE program. */
export const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGho8KDXgL');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const DEFAULT_DISPUTE_WINDOW = 3600n;
export const STALE_SECONDS = 604800n;
export const DISPUTE_TIMEOUT = 1209600n;
const MAX_U64 = (1n << 64n) - 1n;
export type InstructionName = 'initialize_config' | 'update_config' | 'propose_admin' | 'accept_admin' | 'create_mission' | 'cancel_mission'
  | 'accept_mission' | 'submit_delivery' | 'record_verdict' | 'open_dispute' | 'resolve_dispute'
  | 'finalize' | 'refund_expired' | 'refund_stale';
export type MissionStatus = 'open' | 'accepted' | 'submitted' | 'passed' | 'failed' | 'disputed'
  | 'settled' | 'refunded' | 'cancelled';
export interface Mission {
  client: PublicKey; agent: PublicKey | null; designatedAgent: PublicKey | null; missionId: BN; amount: BN;
  criteriaHash: number[]; criteriaUri: string; deliveryHash: number[] | null;
  deliveryUri: string | null; reportHash: number[] | null; deadline: BN;
  disputeWindow: BN; verdictAt: BN | null; disputedAt: BN | null; originalVerdict: boolean | null; status: Record<string, object>;
  bump: number; vaultBump: number;
}
export interface Config {
  admin: PublicKey; pendingAdmin: PublicKey | null; validator: PublicKey; mint: PublicKey; minDisputeWindow: BN;
  maxAmount: BN; paused: boolean; bump: number;
}
export function u64le(value: bigint): Buffer {
  if (value < 0n || value > MAX_U64) throw new RangeError('u64 out of range');
  const result = Buffer.alloc(8); result.writeBigUInt64LE(value); return result;
}
export function configPda(programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
}
export function missionPda(client: PublicKey, missionId: bigint, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('mission'), client.toBuffer(), u64le(missionId)], programId);
}
export function vaultPda(mission: PublicKey, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), mission.toBuffer()], programId);
}
export function programDataPda(programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], UPGRADEABLE_LOADER_ID);
}
function normalized(name: string): string { return name.replaceAll('_', '').toLowerCase(); }
function field(record: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(record).find(k => normalized(k) === normalized(name));
  return key === undefined ? undefined : record[key];
}
/** Uses the generated IDL instead of a hand-maintained contract copy. */
export class MuleClient {
  readonly coder: BorshCoder;
  constructor(readonly idl: Idl, readonly programId = PROGRAM_ID, private readonly history?: MissionIdHistory) {
    if (idl.address !== programId.toBase58()) throw new Error('IDL program address mismatch');
    this.coder = new BorshCoder(idl);
  }
  instruction(name: InstructionName, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}): TransactionInstruction {
    const definition = this.idl.instructions.find(ix => normalized(ix.name) === normalized(name));
    if (!definition) throw new Error('Instruction missing from IDL: ' + name);
    const keys: AccountMeta[] = definition.accounts.map(account => {
      if ('accounts' in account) throw new Error('Nested account groups are not supported');
      const pubkey = field(accounts, account.name);
      if (!(pubkey instanceof PublicKey)) throw new Error('Missing account: ' + account.name);
      return { pubkey, isSigner: account.signer === true, isWritable: account.writable === true };
    });
    const encodedArgs: Record<string, unknown> = {};
    for (const arg of definition.args) {
      let value = field(args, arg.name);
      if (value === undefined) throw new Error('Missing argument: ' + arg.name);
      if (arg.type === 'u64' || arg.type === 'i64') {
        const min = arg.type === 'u64' ? 0n : -(1n << 63n);
        const max = arg.type === 'u64' ? MAX_U64 : (1n << 63n) - 1n;
        if (typeof value === 'bigint') {
          if (value < min || value > max) throw new RangeError('64-bit integer out of range');
          // Preserve bits; do not round-trip a BN through decimal text for range checks.
          value = new BN(value.toString(16), 16);
        } else {
          if (!BN.isBN(value)) throw new TypeError('64-bit integers require bigint or BN');
          if (value.lt(new BN(min.toString(16), 16)) || value.gt(new BN(max.toString(16), 16))) {
            throw new RangeError('64-bit integer out of range');
          }
        }
      }
      encodedArgs[arg.name] = value;
    }
    const instruction = new TransactionInstruction({ programId: this.programId, keys,
      data: this.coder.instruction.encode(definition.name, encodedArgs) });
    if (name === 'create_mission') {
      if (!this.history) throw new Error('create_mission requires a shared durable MissionIdHistory');
      const client = field(accounts, 'client');
      const id = field(encodedArgs, 'mission_id');
      if (!(client instanceof PublicKey) || !BN.isBN(id)) throw new Error('Invalid mission identity');
      // Hex avoids any decimal conversion or JavaScript number truncation.
      const key = JSON.stringify([this.programId.toBase58(), client.toBase58(), id.toString(16).padStart(16, '0')]);
      if (!this.history.reserve(key)) throw new MissionIdAlreadyUsedError();
    }
    return instruction;
  }
  /** Acceptance always reads the canonical Config, including current validator rotation. */
  acceptMissionInstruction(actor: PublicKey, mission: PublicKey): TransactionInstruction {
    return this.instruction('accept_mission', { actor, config: configPda(this.programId)[0], mission });
  }
  decodeMission(data: Buffer): Mission {
    const name = this.idl.accounts?.find(a => normalized(a.name) === 'mission')?.name;
    if (!name) throw new Error('Mission account missing from IDL');
    return camelFields(this.coder.accounts.decode<Record<string, unknown>>(name, data)) as unknown as Mission;
  }
  decodeConfig(data: Buffer): Config {
    const name = this.idl.accounts?.find(a => normalized(a.name) === 'config')?.name;
    if (!name) throw new Error('Config account missing from IDL');
    return camelFields(this.coder.accounts.decode<Record<string, unknown>>(name, data)) as unknown as Config;
  }
  events(logs: string[], transactionError: unknown): Array<{ name: string; data: Record<string, unknown> }> {
    if (transactionError !== null) return [];
    return Array.from(new EventParser(this.programId, this.coder).parseLogs(logs))
      .map(event => ({ name: event.name, data: camelFields(event.data) }));
  }
}
function camelFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), entry,
  ]));
}
export function missionStatus(mission: Mission): MissionStatus {
  const key = Object.keys(mission.status)[0]?.toLowerCase();
  const states: MissionStatus[] = ['open', 'accepted', 'submitted', 'passed', 'failed', 'disputed', 'settled', 'refunded', 'cancelled'];
  if (!states.includes(key as MissionStatus)) throw new Error('Unknown mission status');
  return key as MissionStatus;
}
export { BorshAccountsCoder, BN, type Idl };
