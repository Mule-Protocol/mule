/** MULE JSON encoding: sorted object keys, UTF-8, no insignificant whitespace,
 * one final LF. Reject values JSON would silently drop or coerce. Not RFC 8785. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('Only finite JSON numbers are supported');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new Error('Not a JSON value');
    if (ancestors.has(item)) throw new Error('Cyclic JSON');
    ancestors.add(item);
    let encoded: string;
    if (Array.isArray(item)) {
      const parts: string[] = [];
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) throw new Error('Sparse JSON array');
        parts.push(encode(item[index]));
      }
      encoded = '[' + parts.join(',') + ']';
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new Error('Only plain JSON objects are supported');
      }
      if (Object.getOwnPropertySymbols(item).length) throw new Error('Symbol keys are not JSON');
      const record = item as Record<string, unknown>;
      encoded = '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + encode(record[key])).join(',') + '}';
    }
    ancestors.delete(item);
    return encoded;
  };
  return encode(value) + '\n';
}
