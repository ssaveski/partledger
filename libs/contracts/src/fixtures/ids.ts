/** A stable synthetic UUID for a serial, so fixtures can refer to each other by number. */
export function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

/** A stable, random-looking SHA-256 stand-in; no real file has this hash. */
export function fixtureHash(seed: number): string {
  let state = seed;
  let hash = '';
  while (hash.length < 64) {
    state = (state * 48271) % 2147483647;
    hash += (state % 16).toString(16);
  }
  return hash;
}
