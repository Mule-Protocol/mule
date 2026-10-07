/**
 * Shared mission-ID ledger. Implementations MUST atomically reserve a key and
 * persist it before returning true. A reservation is never released: even an
 * unsubmitted or failed transaction consumes the SDK ID.
 *
 * All instances for a program/client must share the same retained ledger.
 */
export interface MissionIdHistory {
  reserve(key: string): boolean;
}

/** Ephemeral ledger for isolated tests only. It does not survive a restart. */
export class InMemoryMissionIdHistory implements MissionIdHistory {
  private readonly reserved = new Set<string>();
  reserve(key: string): boolean {
    if (this.reserved.has(key)) return false;
    this.reserved.add(key);
    return true;
  }
}

export class MissionIdAlreadyUsedError extends Error {
  constructor() {
    super('Mission ID already reserved in this program/client history; choose a fresh ID');
    this.name = 'MissionIdAlreadyUsedError';
  }
}
