import {
  commitmentPattern,
  isCommitmentReference,
  isJsonObject,
  jsonValueOf,
  type JsonObject,
  type JsonValue,
} from '@partledger/chain';
import { z } from 'zod';

/**
 * What an audit payload may hold (KTD17, R26, R39), decided by value, never by field name:
 * identifiers, content hashes, ISO timestamps, code-declared tokens (enumeration values,
 * command and event names), numbers, booleans, null, and `Commitment`s, in arrays and objects
 * whose keys are tokens. Any other string is refused: personal and free-text values reach the
 * chain only as commitments.
 *
 * The compiler refuses a plain `string` anywhere in a payload's type: a string must be a
 * literal type (a declared enumeration value) or one of the branded forms below, which only
 * their validating constructors produce. The writer checks the same forms at run time, where
 * a literal shows up as a token.
 */

/** camelCase, snake_case or dotted identifiers, as code declares them; never text with spaces or capitals first. */
export const auditTokenPattern = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-zA-Z0-9]+)*$/;
const auditTokenMaximumLength = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const auditIdSchema = z.string().regex(uuidPattern).brand<'AuditId'>();
export const auditHashSchema = z.string().regex(hashPattern).brand<'AuditHash'>();
export const auditTimeSchema = z
  .string()
  .regex(isoTimePattern)
  .refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value)
  .brand<'AuditTime'>();
export const auditTokenSchema = z.string().max(auditTokenMaximumLength).regex(auditTokenPattern).brand<'AuditToken'>();

export type AuditId = z.output<typeof auditIdSchema>;
export type AuditHash = z.output<typeof auditHashSchema>;
export type AuditTime = z.output<typeof auditTimeSchema>;
export type AuditToken = z.output<typeof auditTokenSchema>;

/** A lowercase uuid. */
export function auditId(value: string): AuditId {
  return auditIdSchema.parse(value);
}

/** A SHA-256 content hash as lowercase hex. */
export function auditHash(value: string): AuditHash {
  return auditHashSchema.parse(value);
}

export function auditTime(value: Date): AuditTime {
  return auditTimeSchema.parse(value.toISOString());
}

/** A name declared in code, such as a status or transition from a transition table. */
export function auditToken(value: string): AuditToken {
  return auditTokenSchema.parse(value);
}

/** A commitment as a payload carries it; only the commitment store creates one. */
export const commitmentSchema = z
  .object({ commitment: z.string().regex(commitmentPattern) })
  .strict()
  .brand<'Commitment'>();

export type Commitment = z.output<typeof commitmentSchema>;

/**
 * A plain `string` is refused; a branded form passes; a literal passes only when it looks like
 * a token: no spaces, not capitalised. The writer checks the token pattern in full at run time.
 */
type SafeString<Value extends string> = string extends Value
  ? never
  : Value extends AuditId | AuditHash | AuditTime | AuditToken
    ? Value
    : Value extends `${string} ${string}`
      ? never
      : Value extends Capitalize<Value>
        ? never
        : Value;

/**
 * The payload type with every plain `string` turned into `never`, so a payload is accepted
 * where `Payload & AuditSafe<Payload>` is only if each string is a literal or branded form.
 */
export type AuditSafe<Value> = Value extends Commitment | CheckedAuditObject
  ? Value
  : Value extends string
    ? SafeString<Value>
    : Value extends number | boolean | null
      ? Value
      : Value extends readonly (infer Item)[]
        ? readonly AuditSafe<Item>[]
        : Value extends object
          ? { readonly [Key in keyof Value]: AuditSafe<Value[Key]> }
          : never;

export type AuditPayload<Payload extends JsonObject> = Payload & AuditSafe<Payload>;

function isAllowedString(value: string): boolean {
  return (
    uuidPattern.test(value) ||
    hashPattern.test(value) ||
    auditTimeSchema.safeParse(value).success ||
    auditTokenSchema.safeParse(value).success
  );
}

function pointerOf(pointer: string, key: string): string {
  return `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** JSON pointers of every value or key that is not an allowed form. */
export function unsafeAuditValues(value: JsonValue, pointer = ''): string[] {
  if (typeof value === 'string') {
    return isAllowedString(value) ? [] : [pointer];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.flatMap((item, position) => unsafeAuditValues(item, `${pointer}/${position}`));
  }
  if ('commitment' in value) {
    return isCommitmentReference(value) ? [] : [pointer];
  }
  return Object.entries(value).flatMap(([key, member]) => {
    const memberPointer = pointerOf(pointer, key);
    const keyAllowed = key.length <= auditTokenMaximumLength && auditTokenPattern.test(key);
    return [...(keyAllowed ? [] : [memberPointer]), ...unsafeAuditValues(member, memberPointer)];
  });
}

/**
 * An object whose values were checked at run time, such as a command's output, which arrives
 * as `unknown` and is checked in full before it may enter a payload.
 */
export const checkedAuditObjectSchema = z
  .custom<JsonObject>((value) => {
    try {
      const json = jsonValueOf(value);
      return isJsonObject(json) && unsafeAuditValues(json).length === 0;
    } catch {
      return false;
    }
  })
  .brand<'CheckedAuditObject'>();

export type CheckedAuditObject = z.output<typeof checkedAuditObjectSchema>;

/** Checks every value of an object at run time; throws `UnsafeAuditPayloadError` naming what is not allowed. */
export function checkedAuditObject(value: JsonObject): CheckedAuditObject {
  assertAuditSafe(value);
  return checkedAuditObjectSchema.parse(value);
}

export class UnsafeAuditPayloadError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `An audit payload carries values that are not identifiers, hashes, times, tokens or commitments: ${fields.join(', ')}`,
    );
    this.name = 'UnsafeAuditPayloadError';
    this.fields = fields;
  }
}

/** Throws when a payload carries a value outside the allowed forms; a bug, never an expected failure. */
export function assertAuditSafe(value: JsonValue): void {
  const fields = unsafeAuditValues(value);
  if (fields.length > 0) {
    throw new UnsafeAuditPayloadError(fields);
  }
}
