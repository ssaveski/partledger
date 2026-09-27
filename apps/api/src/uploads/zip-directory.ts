/**
 * Reads a ZIP file's central directory (APPNOTE 6.3.10, sections 4.3.12 and 4.3.16) without
 * decompressing anything, so the upload check and the parse worker agree on what a workbook
 * holds. Only the forms a spreadsheet needs are accepted: one disk, no ZIP64, no encryption,
 * stored or deflated entries, safe and unique names. Anything else is refused, not guessed at.
 *
 * This file runs inside the parse worker too, which Node loads without a bundler, so it
 * imports nothing and uses only syntax that type stripping erases.
 */

export interface ZipEntry {
  readonly name: string;
  /** The name exactly as the directory stores it, which the local header must repeat. */
  readonly nameBytes: Uint8Array;
  /** General purpose flags; bit 3 means the local header leaves the sizes to a data descriptor. */
  readonly flags: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export type ZipProblem =
  | 'notZip'
  | 'multipleDisks'
  | 'zip64'
  | 'tooManyEntries'
  | 'directoryTooLarge'
  | 'malformed'
  | 'encrypted'
  | 'unsupportedCompression'
  | 'unsafeName'
  | 'duplicateName';

export type ZipDirectory =
  { readonly ok: true; readonly entries: readonly ZipEntry[] } | { readonly ok: false; readonly problem: ZipProblem };

const endOfDirectorySignature = 0x06054b50;
const directoryEntrySignature = 0x02014b50;
const localHeaderSignature = 0x04034b50;
const endOfDirectoryLength = 22;
const maximumCommentLength = 0xffff;
const stored = 0;
const deflated = 8;

function refused(problem: ZipProblem): ZipDirectory {
  return { ok: false, problem };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isUnsafeName(name: string): boolean {
  return (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\u0000') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').some((segment) => segment === '..')
  );
}

/**
 * `tail` is the last bytes of a file of `totalSize` bytes (or the whole file); the central
 * directory must lie inside it, which bounds how much an upload keeps in memory.
 */
export function readZipDirectory(
  tail: Uint8Array,
  totalSize: number,
  limits: { readonly maximumEntries: number },
): ZipDirectory {
  const tailOffset = totalSize - tail.byteLength;
  if (tail.byteLength < endOfDirectoryLength || tailOffset < 0) {
    return refused('notZip');
  }
  const data = view(tail);
  const earliest = Math.max(0, tail.byteLength - endOfDirectoryLength - maximumCommentLength);
  let end = -1;
  for (let position = tail.byteLength - endOfDirectoryLength; position >= earliest; position -= 1) {
    if (
      data.getUint32(position, true) === endOfDirectorySignature &&
      position + endOfDirectoryLength + data.getUint16(position + 20, true) === tail.byteLength
    ) {
      end = position;
      break;
    }
  }
  if (end === -1) {
    return refused('notZip');
  }
  const diskNumber = data.getUint16(end + 4, true);
  const directoryDisk = data.getUint16(end + 6, true);
  const entriesOnDisk = data.getUint16(end + 8, true);
  const entryCount = data.getUint16(end + 10, true);
  const directorySize = data.getUint32(end + 12, true);
  const directoryOffset = data.getUint32(end + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return refused('zip64');
  }
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    return refused('multipleDisks');
  }
  if (entryCount > limits.maximumEntries) {
    return refused('tooManyEntries');
  }
  const start = directoryOffset - tailOffset;
  if (start < 0) {
    return refused('directoryTooLarge');
  }
  if (start + directorySize !== end) {
    return refused('malformed');
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let position = start;
  for (let index = 0; index < entryCount; index += 1) {
    if (position + 46 > end || data.getUint32(position, true) !== directoryEntrySignature) {
      return refused('malformed');
    }
    const flags = data.getUint16(position + 8, true);
    const compressionMethod = data.getUint16(position + 10, true);
    const compressedSize = data.getUint32(position + 20, true);
    const uncompressedSize = data.getUint32(position + 24, true);
    const nameLength = data.getUint16(position + 28, true);
    const extraLength = data.getUint16(position + 30, true);
    const commentLength = data.getUint16(position + 32, true);
    const startDisk = data.getUint16(position + 34, true);
    const localHeaderOffset = data.getUint32(position + 42, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end) {
      return refused('malformed');
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      return refused('zip64');
    }
    if (startDisk !== 0) {
      return refused('multipleDisks');
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      return refused('encrypted');
    }
    if (compressionMethod !== stored && compressionMethod !== deflated) {
      return refused('unsupportedCompression');
    }
    if (localHeaderOffset + 30 > directoryOffset || localHeaderOffset + compressedSize > directoryOffset) {
      return refused('malformed');
    }
    const nameBytes = tail.subarray(position + 46, position + 46 + nameLength);
    const utf8 = (flags & 0x0800) !== 0;
    let name: string;
    try {
      name = new TextDecoder(utf8 ? 'utf-8' : 'latin1', { fatal: true }).decode(nameBytes);
    } catch {
      return refused('unsafeName');
    }
    if (isUnsafeName(name)) {
      return refused('unsafeName');
    }
    if (names.has(name)) {
      return refused('duplicateName');
    }
    names.add(name);
    entries.push({
      name,
      nameBytes: Uint8Array.from(nameBytes),
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    position = next;
  }
  return { ok: true, entries };
}

/**
 * Where an entry's compressed data starts in the whole file, or null when its local header
 * disagrees with the directory: another name, another method, or, unless a data descriptor
 * follows (flag bit 3), other sizes. Readers differ in which of the two they trust, so a
 * workbook whose two copies differ could show one part to this check and another to a parser.
 */
export function entryDataOffset(file: Uint8Array, entry: ZipEntry): number | null {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > file.byteLength) {
    return null;
  }
  const data = view(file);
  if (data.getUint32(offset, true) !== localHeaderSignature) {
    return null;
  }
  const nameLength = data.getUint16(offset + 26, true);
  const extraLength = data.getUint16(offset + 28, true);
  const localName = file.subarray(offset + 30, offset + 30 + nameLength);
  const sameName =
    nameLength === entry.nameBytes.byteLength && localName.every((byte, index) => byte === entry.nameBytes[index]);
  const sameSizes =
    (entry.flags & 0x0008) !== 0 ||
    (data.getUint32(offset + 18, true) === entry.compressedSize &&
      data.getUint32(offset + 22, true) === entry.uncompressedSize);
  if (!sameName || data.getUint16(offset + 8, true) !== entry.compressionMethod || !sameSizes) {
    return null;
  }
  const start = offset + 30 + nameLength + extraLength;
  return start + entry.compressedSize <= file.byteLength ? start : null;
}

/** What a workbook may not carry: macros, Excel 4 macro sheets, ActiveX controls or embedded objects. */
const activeContentPatterns = [
  /(^|\/)vbaProject\.bin$/i,
  /(^|\/)vbaProjectSignature\.bin$/i,
  /^xl\/macrosheets\//i,
  /^xl\/dialogsheets\//i,
  /^xl\/activeX\//i,
  /^xl\/embeddings\//i,
];

/** Links to other workbooks, which a spreadsheet program may fetch or update when the file opens. */
const externalContentPatterns = [/^xl\/externalLinks\//i];

export type WorkbookShape = 'workbook' | 'macroEnabled' | 'externalContent' | 'notWorkbook';

/** Judges an XLSX by the names in its central directory, before anything is decompressed. */
export function workbookShapeOf(entries: readonly ZipEntry[]): WorkbookShape {
  const names = entries.map((entry) => entry.name);
  if (names.some((name) => activeContentPatterns.some((pattern) => pattern.test(name)))) {
    return 'macroEnabled';
  }
  if (names.some((name) => externalContentPatterns.some((pattern) => pattern.test(name)))) {
    return 'externalContent';
  }
  return names.includes('[Content_Types].xml') && names.includes('xl/workbook.xml') ? 'workbook' : 'notWorkbook';
}
