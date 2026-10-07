import { canonicalJson } from '@mule/mission-logic';

export interface JsonArtifact<T> { value: T; json: string; hash: string }
/** Hash precisely the canonical UTF-8 bytes, including the terminating LF. */
export async function sha256(json: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function prepareArtifact<T>(value: T): Promise<JsonArtifact<T>> {
  const json = canonicalJson(value);
  return { value, json, hash: await sha256(json) };
}
export function shortHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Expected a full SHA-256');
  return 'sha256:' + hash.slice(0, 4) + '…' + hash.slice(-4);
}
