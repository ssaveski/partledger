/**
 * The text check for CSV (KTD22), shared by the upload check and the parse worker. It runs
 * inside the parse worker too, which Node loads without a bundler, so it imports nothing.
 */

/** C0 controls other than tab, line feed and carriage return, and DEL. */
function isBinaryControl(byte: number): boolean {
  return (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f;
}

/**
 * Checks streamed content as CSV text: valid UTF-8 throughout, including a character split
 * across chunks, with no NUL or other binary control character.
 */
export class TextContentCheck {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private valid = true;

  push(chunk: Uint8Array): boolean {
    if (!this.valid) {
      return false;
    }
    if (chunk.some(isBinaryControl)) {
      this.valid = false;
      return false;
    }
    try {
      this.decoder.decode(chunk, { stream: true });
    } catch {
      this.valid = false;
    }
    return this.valid;
  }

  /** Whether everything pushed was text, including no truncated character at the end. */
  finish(): boolean {
    if (!this.valid) {
      return false;
    }
    try {
      this.decoder.decode();
    } catch {
      this.valid = false;
    }
    return this.valid;
  }
}
