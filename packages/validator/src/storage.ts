import { canonicalJson } from '@mule/mission-logic';
export { canonicalJson } from '@mule/mission-logic';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CONTENT_URI_PREFIX = 'https://raw.githubusercontent.com/Mule-Protocol/mule/main/data/';
const HASH = /^[a-f0-9]{64}$/;
export interface StoredJson { hash: string; uri: string; path: string }

export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function contentUri(hash: string): string {
  if (!HASH.test(hash)) throw new Error('Invalid content SHA-256');
  const uri = CONTENT_URI_PREFIX + hash + '.json';
  if (Buffer.byteLength(uri, 'utf8') > 200) throw new Error('Content URI exceeds 200 bytes');
  return uri;
}
function referenceHash(reference: string): string {
  if (HASH.test(reference)) return reference;
  const hash = reference.startsWith(CONTENT_URI_PREFIX)
    ? reference.slice(CONTENT_URI_PREFIX.length, -5) : '';
  if (!reference.endsWith('.json') || !HASH.test(hash) || reference !== contentUri(hash)) {
    throw new Error('Unsupported content reference; only MULE main/data URIs or SHA-256 are accepted');
  }
  return hash;
}

/** Files only; this class never fetches a URI over HTTP. Every read rehashes bytes. */
export class LocalContentStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  put(value: unknown): StoredJson {
    const bytes = canonicalJson(value);
    const hash = sha256(bytes);
    const uri = contentUri(hash);
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, hash + '.json');
    if (existsSync(path)) {
      this.read(uri, hash); // A corrupted existing object cannot be silently overwritten.
    } else {
      let descriptor: number | undefined;
      try {
        descriptor = openSync(path, 'wx', 0o644);
        writeFileSync(descriptor, bytes, 'utf8');
        fsyncSync(descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        this.read(uri, hash);
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    }
    return { hash, uri, path };
  }

  read<T = unknown>(reference: string, expectedHash?: string): T {
    const hash = referenceHash(reference);
    if (expectedHash !== undefined && (!HASH.test(expectedHash) || expectedHash !== hash)) {
      throw new Error('Content URI and expected SHA-256 disagree');
    }
    const path = join(this.directory, hash + '.json');
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      throw new Error('Content object must be a regular local file');
    }
    const bytes = readFileSync(path);
    if (sha256(bytes) !== hash) throw new Error('Content SHA-256 mismatch');
    return JSON.parse(bytes.toString('utf8')) as T;
  }
}
