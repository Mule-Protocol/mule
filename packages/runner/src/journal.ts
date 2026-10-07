import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Crash-safe replacement in a retained, private local directory. No secret keys belong in this journal. */
export function durableJson(path: string, value: unknown): void {
  const temporary = path + '.tmp-' + process.pid;
  const descriptor = openSync(temporary, 'w', 0o600);
  try { writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temporary, path);
  if (process.platform !== 'win32') {
    const directory = openSync(join(path, '..'), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
export class Journal {
  constructor(readonly directory: string) { mkdirSync(directory, {recursive: true, mode: 0o700}); }
  path(key: string): string { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json'); }
  read<T>(key: string): T | null {
    const path = this.path(key);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
  }
  write(key: string, value: unknown): void { durableJson(this.path(key), value); }
}
