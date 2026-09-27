import { commitmentPattern, isCommitmentReference, type JsonObject, type JsonValue } from '@partledger/chain';
import { z } from 'zod';

/**
 * Personal and free-text values (names, contact details, justifications, reasons) enter the
 * chain only as salted commitments (KTD17, R39). A payload field is personal when its name is
 * one of these words, alone or as the suffix of a camelCase name (`approverName`,
 * `contactEmails`); such a field must hold a commitment. The compiler refuses a raw value
 * where the payload's type is known, and the audit writer refuses it at run time.
 */
export const personalFieldWords = [
  'name',
  'email',
  'phone',
  'address',
  'justification',
  'reason',
  'comment',
  'note',
  'message',
] as const;

type PersonalWord = (typeof personalFieldWords)[number];

type PersonalStem = PersonalWord | `${string}${Capitalize<PersonalWord>}`;

export type PersonalFieldName = PersonalStem | `${PersonalStem}s`;

/** A commitment as a payload carries it; only the commitment store creates one. */
export const commitmentSchema = z
  .object({ commitment: z.string().regex(commitmentPattern) })
  .strict()
  .brand<'Commitment'>();

export type Commitment = z.output<typeof commitmentSchema>;

/**
 * The payload type with every personal field required to be a `Commitment`. A payload is
 * accepted where `Payload & WithCommitments<Payload>` is, so a raw string in a personal
 * field fails to compile.
 */
export type WithCommitments<Value> = Value extends Commitment
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly WithCommitments<Item>[]
    : Value extends object
      ? {
          readonly [Key in keyof Value]: Key extends PersonalFieldName
            ? Commitment | null
            : WithCommitments<Value[Key]>;
        }
      : Value;

export type CommittedPayload<Payload extends JsonObject> = Payload & WithCommitments<Payload>;

export function isPersonalFieldName(name: string): boolean {
  const stem = name.endsWith('s') ? name.slice(0, -1) : name;
  return personalFieldWords.some((word) => {
    const capitalised = `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    return name === word || stem === word || name.endsWith(capitalised) || stem.endsWith(capitalised);
  });
}

/** JSON pointers of personal fields that hold anything but a commitment or `null`. */
export function rawPersonalFields(value: JsonValue, pointer = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.flatMap((item, position) => rawPersonalFields(item, `${pointer}/${position}`));
  }
  return Object.entries(value).flatMap(([key, member]) => {
    const memberPointer = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (isPersonalFieldName(key)) {
      return member === null || isCommitmentReference(member) ? [] : [memberPointer];
    }
    return rawPersonalFields(member, memberPointer);
  });
}

export class RawPersonalDataError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`An audit payload carries personal or free-text values that are not commitments: ${fields.join(', ')}`);
    this.name = 'RawPersonalDataError';
    this.fields = fields;
  }
}

/** Throws when a payload carries a raw personal value; a bug, never an expected failure. */
export function assertCommittedPayload(value: JsonValue): void {
  const fields = rawPersonalFields(value);
  if (fields.length > 0) {
    throw new RawPersonalDataError(fields);
  }
}
