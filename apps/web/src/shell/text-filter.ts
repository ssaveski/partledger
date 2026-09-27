/** Whether any field contains every word of the query, ignoring case and accents; an empty query matches. */
export function matchesText(query: string | undefined, fields: readonly string[]): boolean {
  const words = fold(query ?? '')
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) {
    return true;
  }
  const haystack = fields.map(fold).join(' ');
  return words.every((word) => haystack.includes(word));
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-CA');
}

/** A filter value for the address: blank text is no filter, so it leaves the address. */
export function searchValue(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : text;
}
