import { inflateRawSync } from 'node:zlib';

import { read, utils } from 'xlsx';

import { TextContentCheck } from './text-content.ts';
import { entryDataOffset, readZipDirectory, workbookShapeOf, type ZipEntry } from './zip-directory.ts';

/**
 * The parse worker's process (KTD22, KTD26). Its parent starts it with a small V8 heap and no
 * environment, and kills it at its time limit. Before the spreadsheet parser sees a workbook, every
 * entry is decompressed here under caps, so a decompression bomb stops at the cap, and every
 * XML part is refused if it declares a DTD or an entity, so neither entity expansion nor an
 * external entity ever reaches a parser. Node loads this file without a bundler: it imports
 * only Node, the parser and the two dependency-free checks beside it.
 */

export interface ParseLimits {
  /** The most one ZIP entry may decompress to. */
  readonly maximumEntryBytes: number;
  /** The most all entries together may decompress to. */
  readonly maximumTotalBytes: number;
  /** The most an entry larger than 1 MiB may expand by. */
  readonly maximumCompressionRatio: number;
  readonly maximumEntries: number;
  readonly maximumRows: number;
  readonly maximumColumns: number;
  readonly maximumCellLength: number;
}

export type ParseProblem =
  | 'notWorkbook'
  | 'macroEnabled'
  | 'externalContent'
  | 'malformedArchive'
  | 'decompressionLimit'
  | 'dtdNotAllowed'
  | 'encodingNotAllowed'
  | 'notText'
  | 'unparseable'
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'cellTooLong';

export interface ParsedSheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

export type ParseRequest = {
  readonly format: 'xlsx' | 'csv';
  readonly bytes: Uint8Array;
  readonly limits: ParseLimits;
};

export type ParseReply =
  | { readonly ok: true; readonly sheets: readonly ParsedSheet[] }
  | { readonly ok: false; readonly problem: ParseProblem };

class Refused extends Error {
  readonly problem: ParseProblem;

  constructor(problem: ParseProblem) {
    super(problem);
    this.problem = problem;
  }
}

const mebibyte = 1024 * 1024;

function inflateEntry(file: Uint8Array, entry: ZipEntry, limits: ParseLimits, remaining: number): Buffer {
  const declared = entry.uncompressedSize;
  if (
    declared > limits.maximumEntryBytes ||
    declared > remaining ||
    (declared > mebibyte && declared > entry.compressedSize * limits.maximumCompressionRatio)
  ) {
    throw new Refused('decompressionLimit');
  }
  const start = entryDataOffset(file, entry);
  if (start === null) {
    throw new Refused('malformedArchive');
  }
  const compressed = file.subarray(start, start + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== declared) {
      throw new Refused('malformedArchive');
    }
    return Buffer.from(compressed);
  }
  let inflated: Buffer;
  try {
    // One byte more than declared, so an entry that lies about its size is caught, not truncated.
    inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(1, declared + 1) });
  } catch (error) {
    throw new Refused(
      error instanceof RangeError ||
        (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
        ? 'decompressionLimit'
        : 'malformedArchive',
    );
  }
  if (inflated.byteLength !== declared) {
    throw new Refused(inflated.byteLength > declared ? 'decompressionLimit' : 'malformedArchive');
  }
  return inflated;
}

const markupPart = /\.(xml|rels|vml)$/i;

/**
 * No part may declare a DTD or an entity, whatever its name: a parser follows the relationships,
 * not the file extensions, so a sheet stored as `sheet1.data` is parsed as XML all the same.
 */
function refuseDeclarations(content: Buffer): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(content.toString('latin1'))) {
    throw new Refused('dtdNotAllowed');
  }
}

/** A part named as markup must be UTF-8. */
function checkMarkup(content: Buffer): void {
  if (
    (content[0] === 0xfe && content[1] === 0xff) ||
    (content[0] === 0xff && content[1] === 0xfe) ||
    content.subarray(0, 4).includes(0)
  ) {
    throw new Refused('encodingNotAllowed');
  }
  const text = content.toString('latin1');
  const declaration = /^(?:\xEF\xBB\xBF)?<\?xml[^>]*\bencoding\s*=\s*["']([^"']*)["']/.exec(text);
  const encoding = declaration?.[1]?.toLowerCase();
  if (encoding !== undefined && encoding !== 'utf-8' && encoding !== 'utf8') {
    throw new Refused('encodingNotAllowed');
  }
}

function checkedRows(rows: readonly (readonly unknown[])[], limits: ParseLimits): string[][] {
  if (rows.length > limits.maximumRows) {
    throw new Refused('tooManyRows');
  }
  return rows.map((row) => {
    if (row.length > limits.maximumColumns) {
      throw new Refused('tooManyColumns');
    }
    return row.map((cell) => {
      const text =
        typeof cell === 'string' ? cell : typeof cell === 'number' || typeof cell === 'boolean' ? String(cell) : '';
      if (text.length > limits.maximumCellLength) {
        throw new Refused('cellTooLong');
      }
      return text;
    });
  });
}

function parseWorkbook(file: Uint8Array, limits: ParseLimits): ParsedSheet[] {
  const directory = readZipDirectory(file, file.byteLength, { maximumEntries: limits.maximumEntries });
  if (!directory.ok) {
    throw new Refused(directory.problem === 'notZip' ? 'notWorkbook' : 'malformedArchive');
  }
  const shape = workbookShapeOf(directory.entries);
  if (shape !== 'workbook') {
    throw new Refused(shape);
  }
  let remaining = limits.maximumTotalBytes;
  for (const entry of directory.entries) {
    const content = inflateEntry(file, entry, limits, remaining);
    remaining -= content.byteLength;
    refuseDeclarations(content);
    if (markupPart.test(entry.name)) {
      checkMarkup(content);
    }
    if (entry.name === '[Content_Types].xml' && /macroEnabled|vbaProject/i.test(content.toString('latin1'))) {
      throw new Refused('macroEnabled');
    }
  }
  let workbook: ReturnType<typeof read>;
  try {
    workbook = read(Buffer.from(file.buffer, file.byteOffset, file.byteLength), {
      type: 'buffer',
      dense: true,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellDates: false,
      bookVBA: false,
      sheetRows: limits.maximumRows + 1,
    });
  } catch {
    throw new Refused('unparseable');
  }
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows: unknown[][] =
      sheet === undefined ? [] : utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    return { name, rows: checkedRows(rows, limits) };
  });
}

/** RFC 4180: comma-separated fields, double quotes around fields that hold commas, quotes or line breaks. */
function parseCsv(file: Uint8Array, limits: ParseLimits): ParsedSheet[] {
  const check = new TextContentCheck();
  if (!check.push(file) || !check.finish()) {
    throw new Refused('notText');
  }
  // The decoder drops a leading byte order mark.
  const text = new TextDecoder('utf-8').decode(file);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let position = 0;
  const endField = () => {
    if (field.length > limits.maximumCellLength) {
      throw new Refused('cellTooLong');
    }
    row.push(field);
    field = '';
    if (row.length > limits.maximumColumns) {
      throw new Refused('tooManyColumns');
    }
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
      if (rows.length > limits.maximumRows) {
        throw new Refused('tooManyRows');
      }
    }
    row = [];
  };
  while (position < text.length) {
    const character = text[position] ?? '';
    if (quoted) {
      if (character === '"') {
        if (text[position + 1] === '"') {
          field += '"';
          position += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && field === '') {
      quoted = true;
    } else if (character === ',') {
      endField();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[position + 1] === '\n') {
        position += 1;
      }
      endRow();
    } else if (character === '"') {
      throw new Refused('unparseable');
    } else {
      field += character;
    }
    position += 1;
  }
  if (quoted) {
    throw new Refused('unparseable');
  }
  if (field !== '' || row.length > 0) {
    endRow();
  }
  return [{ name: 'csv', rows }];
}

function handle(request: ParseRequest): ParseReply {
  try {
    const sheets =
      request.format === 'xlsx'
        ? parseWorkbook(request.bytes, request.limits)
        : parseCsv(request.bytes, request.limits);
    return { ok: true, sheets };
  } catch (error) {
    return { ok: false, problem: error instanceof Refused ? error.problem : 'unparseable' };
  }
}

process.once('message', (request: ParseRequest) => {
  process.send?.(handle(request));
});
