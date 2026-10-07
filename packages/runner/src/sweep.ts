import { PublicKey } from '@solana/web3.js';
import { DISPUTE_TIMEOUT, STALE_SECONDS, missionStatus, type Mission } from '@mule/sdk';

export type SweepInstruction = 'finalize' | 'refund_expired' | 'refund_stale';
export interface Receipt { signature: string; events: Array<{name: string; data: Record<string, unknown>}> }
export interface SweepPort {
  now(): Promise<bigint>;
  mission(address: PublicKey): Promise<Mission | null>;
  execute(address: PublicKey, instruction: SweepInstruction): Promise<Receipt>;
}
export interface SweepResult extends Receipt { mission: string; instruction: SweepInstruction }

/** Shared by RPC and clock-advanced LiteSVM tests. Never substitutes a wall clock for chain time. */
export async function sweep(port: SweepPort, addresses: PublicKey[]): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const address of addresses) {
    const mission = await port.mission(address);
    if (!mission) continue;
    const now = await port.now();
    const state = missionStatus(mission);
    let instruction: SweepInstruction | undefined;
    if ((state === 'open' || state === 'accepted') && now >= BigInt(mission.deadline.toString())) {
      instruction = 'refund_expired';
    } else if (state === 'submitted' && mission.verdictAt === null
      && now >= BigInt(mission.deadline.toString()) + STALE_SECONDS) {
      instruction = 'refund_stale';
    } else if ((state === 'passed' || state === 'failed') && mission.verdictAt !== null
      && now >= BigInt(mission.verdictAt.toString()) + BigInt(mission.disputeWindow.toString())) {
      instruction = 'finalize';
    } else if (state === 'disputed' && mission.disputedAt !== null
      && now >= BigInt(mission.disputedAt.toString()) + DISPUTE_TIMEOUT) {
      instruction = 'finalize';
    }
    if (instruction) results.push({ mission: address.toBase58(), instruction, ...await port.execute(address, instruction) });
  }
  return results;
}
