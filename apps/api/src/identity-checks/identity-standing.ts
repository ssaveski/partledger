import type { IdentityCheck } from '@partledger/contracts';

/** The registers of R10: the EU VAT register (VIES) and the LEI register (GLEIF). */
export const identityRegisters = ['vies', 'lei'] as const;

export type IdentityRegister = (typeof identityRegisters)[number];

export const identityCheckResults = ['verified', 'mismatch', 'notFound', 'notChecked'] as const;

export type IdentityCheckResult = (typeof identityCheckResults)[number];

/** VIES answers for the EU member states, under their VAT prefixes (EL for Greece, XI for Northern Ireland). */
export const viesPrefixes: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'XI',
]);

export interface SupplierIdentifiers {
  readonly vatId: string | null;
  readonly lei: string | null;
}

/** Each register that applies to the supplier, with the identifier it is asked about. */
export function applicableRegisters(
  supplier: SupplierIdentifiers,
): readonly { readonly register: IdentityRegister; readonly identifier: string }[] {
  const registers: { register: IdentityRegister; identifier: string }[] = [];
  if (supplier.vatId !== null && viesPrefixes.has(supplier.vatId.slice(0, 2))) {
    registers.push({ register: 'vies', identifier: supplier.vatId });
  }
  if (supplier.lei !== null) {
    registers.push({ register: 'lei', identifier: supplier.lei });
  }
  return registers;
}

/** What a register said about an identifier; `unreachable` covers timeouts and outages. */
export type RegisterAnswer =
  | { readonly kind: 'found'; readonly registeredName: string | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'unreachable' };

const legalForms = new Set([
  'ab',
  'ag',
  'as',
  'bv',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'inc',
  'incorporated',
  'kg',
  'limited',
  'llc',
  'ltd',
  'ltee',
  'nv',
  'oy',
  'plc',
  'sa',
  'sarl',
  'sas',
  'spa',
  'srl',
  'the',
]);

function significantWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '' && !legalForms.has(word));
}

/**
 * Whether a register's name for an organisation plausibly names the supplier: the same words,
 * ignoring case, accents, punctuation and legal forms, or one name's words all within the other's.
 */
export function namesMatch(supplierName: string, registeredName: string): boolean {
  const supplierWords = significantWords(supplierName);
  const registeredWords = significantWords(registeredName);
  if (supplierWords.length === 0 || registeredWords.length === 0) {
    return false;
  }
  const [shorter, longer] =
    supplierWords.length <= registeredWords.length
      ? [supplierWords, registeredWords]
      : [registeredWords, supplierWords];
  const available = new Set(longer);
  return shorter.every((word) => available.has(word));
}

/**
 * The stored result of an answer. A register that hides the name (VIES answers `---` for some
 * member states) confirms only the identifier, which counts as verified.
 */
export function resultOf(answer: RegisterAnswer, supplierName: string): IdentityCheckResult {
  switch (answer.kind) {
    case 'unreachable':
      return 'notChecked';
    case 'notFound':
      return 'notFound';
    case 'found':
      return answer.registeredName === null || namesMatch(supplierName, answer.registeredName)
        ? 'verified'
        : 'mismatch';
  }
}

export interface StoredIdentityCheck {
  readonly register: IdentityRegister;
  readonly identifier: string;
  readonly result: IdentityCheckResult;
  readonly checkedAt: Date;
}

const severity: Readonly<Record<IdentityCheckResult, number>> = {
  mismatch: 0,
  notFound: 1,
  notChecked: 2,
  verified: 3,
};

/**
 * The latest check against each register that applies, for the supplier's current identifiers;
 * a register not yet asked about the current identifier reads `notChecked` with no time.
 */
export function latestChecks(supplier: SupplierIdentifiers, checks: readonly StoredIdentityCheck[]): RegisterCheck[] {
  return applicableRegisters(supplier).map(({ register, identifier }) => {
    const latest = checks
      .filter((check) => check.register === register && check.identifier === identifier)
      .reduce<StoredIdentityCheck | undefined>(
        (newest, check) => (newest === undefined || check.checkedAt > newest.checkedAt ? check : newest),
        undefined,
      );
    return latest === undefined
      ? { status: 'notChecked', register, checkedAt: null }
      : { status: latest.result, register, checkedAt: latest.checkedAt.toISOString() };
  });
}

/** One register's latest check, as the reads show it. */
export interface RegisterCheck extends IdentityCheck {
  readonly status: IdentityCheckResult;
  readonly register: IdentityRegister;
}

/**
 * The one check a supplier list shows: the least reassuring of the latest checks, so a mismatch
 * in either register is never hidden behind the other's confirmation.
 */
export function identitySummary(supplier: SupplierIdentifiers, checks: readonly StoredIdentityCheck[]): IdentityCheck {
  const shown = latestChecks(supplier, checks).reduce<RegisterCheck | undefined>(
    (worst, check) => (worst === undefined || severity[check.status] < severity[worst.status] ? check : worst),
    undefined,
  );
  return shown ?? { status: 'notApplicable', register: null, checkedAt: null };
}
