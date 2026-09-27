// One locale until the UI ships more than English (R36); English has only the one and other forms.
const pluralRules = new Intl.PluralRules('en-CA');

/** The message key for a count: `<base>.one` or `<base>.other`, as the catalogue defines both. */
export function countKey(base: string, count: number): string {
  return `${base}.${pluralRules.select(count) === 'one' ? 'one' : 'other'}`;
}
