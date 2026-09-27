import { createHash } from 'node:crypto';

/** A parsed input holding something JSON cannot represent faithfully, so it cannot be fingerprinted. */
export class UnfingerprintableInputError extends Error {
  constructor(path: string, found: string) {
    super(`The input at ${path} is ${found}, which has no JSON form to fingerprint`);
    this.name = 'UnfingerprintableInputError';
  }
}

/**
 * JSON with object keys sorted, so equal inputs give equal bytes whatever their key order.
 * Dates become ISO strings; anything else that is not plain JSON (a Map, a Set, a class
 * instance, a function, a bigint, a symbol, a non-finite number) is refused rather than
 * silently collapsing to `{}` or `null`, which would let different inputs replay each other.
 */
export function sortedJson(value: unknown, path = '(input)'): string {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new UnfingerprintableInputError(path, 'a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new UnfingerprintableInputError(path, `a ${typeof value}`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new UnfingerprintableInputError(path, 'an invalid date');
    }
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown, position) => sortedJson(item, `${path}[${String(position)}]`)).join(',')}]`;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new UnfingerprintableInputError(path, `an instance of ${value.constructor.name}`);
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item, `${path}.${key}`)}`);
  return `{${entries.join(',')}}`;
}

/** SHA-256 of a command's parsed input: fields the schema strips never change it. */
export function inputFingerprint(command: string, input: unknown): Buffer {
  return createHash('sha256').update(sortedJson({ command, input }), 'utf8').digest();
}
