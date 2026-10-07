import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { MissionIdHistory } from './history.js';

/**
 * Durable Node ledger. Every process and runner must share the same directory
 * on a local filesystem with atomic exclusive creation. Keep it after missions
 * close; do not delete, roll it back, or start an empty ledger for an old client.
 *
 * Exclusive creation arbitrates concurrent instances/processes. Existing files,
 * including empty or corrupt files left by crashes, always count as consumed.
 * No failure path removes a reservation. Files are fsynced before success;
 * the directory is also fsynced on POSIX. Windows directory fsync is unavailable:
 * protect the directory against storage loss and retain backups.
 *
 * This cannot constrain raw on-chain calls or callers using a different ledger.
 */
export class FileMissionIdHistory implements MissionIdHistory {
  readonly directory: string;
  constructor(directory: string) {
    if (directory.trim() === '') throw new Error('A retained mission-history directory is required');
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true });
  }
  reserve(key: string): boolean {
    const filename = createHash('sha256').update(key).digest('hex') + '.reserved';
    let descriptor: number;
    try {
      descriptor = openSync(join(this.directory, filename), 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    try {
      writeFileSync(descriptor, key + '\n', 'utf8');
      fsyncSync(descriptor);
    } finally {
      // Leave the reservation present even if writing or syncing failed.
      closeSync(descriptor);
    }
    if (process.platform !== 'win32') {
      const directoryDescriptor = openSync(this.directory, 'r');
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    }
    return true;
  }
}
