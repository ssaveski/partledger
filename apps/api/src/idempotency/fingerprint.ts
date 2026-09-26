import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so equal inputs give equal bytes whatever their key order. */
export function sortedJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => sortedJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`);
  return `{${entries.join(',')}}`;
}

/** SHA-256 of a command's parsed input: fields the schema strips never change it. */
export function inputFingerprint(command: string, input: unknown): Buffer {
  return createHash('sha256').update(sortedJson({ command, input }), 'utf8').digest();
}
