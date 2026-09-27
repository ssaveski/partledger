/**
 * JSON Canonicalization Scheme, RFC 8785. The hash chain hashes these bytes (KTD17), and the
 * standalone verifier recomputes them offline, so this file depends on nothing but the
 * language: property names sorted by UTF-16 code units, numbers in ECMAScript shortest
 * round-trip form, strings escaped only where JSON requires it, no whitespace.
 */

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  /** Where in the value the problem is, as a JSON pointer. */
  readonly pointer: string;

  constructor(problem: string, pointer: string) {
    super(`${problem} at ${pointer === '' ? 'the root' : pointer}`);
    this.name = 'CanonicalJsonError';
    this.pointer = pointer;
  }
}

const loneSurrogate = /\p{Surrogate}/u;

/** The canonical text of a JSON value. Refuses what I-JSON (RFC 7493) refuses: non-finite numbers and lone surrogates. */
export function canonicalize(value: JsonValue): string {
  return serialize(value, '');
}

/** The canonical text as UTF-8 bytes; these are what the chain hashes and stores. */
export function canonicalBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

function serialize(value: unknown, pointer: string): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError('A number must be finite', pointer);
      }
      // ECMAScript Number serialisation is the RFC 8785 number format; it also turns -0 into 0.
      return JSON.stringify(value);
    case 'string':
      return serializeString(value, pointer);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`A ${typeof value} is not JSON`, pointer);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map((item, position) => serialize(item, `${pointer}/${position}`)).join(',')}]`;
  }
  // String comparison is by UTF-16 code units, which is the order RFC 8785 requires.
  const members = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${members
    .map(([key, member]) => {
      const memberPointer = `${pointer}/${escapePointer(key)}`;
      return `${serializeString(key, memberPointer)}:${serialize(member, memberPointer)}`;
    })
    .join(',')}}`;
}

function serializeString(value: string, pointer: string): string {
  if (loneSurrogate.test(value)) {
    throw new CanonicalJsonError('A string must not contain a lone surrogate', pointer);
  }
  // For well-formed strings JSON.stringify escapes exactly '"', '\' and U+0000..U+001F, using
  // \b \t \n \f \r or lowercase \u00xx, as RFC 8785 section 3.2.2.2 requires.
  return JSON.stringify(value);
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * Parses JSON text into a JSON value. `JSON.parse` returns an untyped value; this walks it so
 * the result is typed without a cast.
 */
export function parseJson(text: string): JsonValue {
  const parsed: unknown = JSON.parse(text);
  return jsonValueOf(parsed);
}

/** Types a value that is already plain JSON data, such as a parsed `jsonb` column; refuses anything else. */
export function jsonValueOf(value: unknown): JsonValue {
  return toJsonValue(value, '');
}

function toJsonValue(value: unknown, pointer: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError('A number must be finite', pointer);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item, position) => toJsonValue(item, `${pointer}/${position}`));
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    // fromEntries defines each property, so a "__proto__" member stays a member.
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, toJsonValue(member, `${pointer}/${escapePointer(key)}`)]),
    );
  }
  throw new CanonicalJsonError(`A ${typeof value} is not JSON`, pointer);
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `text` is exactly the canonical form of the JSON it holds. */
export function isCanonical(text: string): boolean {
  try {
    return canonicalize(parseJson(text)) === text;
  } catch {
    return false;
  }
}
