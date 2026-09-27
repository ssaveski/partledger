import { inflateSync } from 'node:zlib';

/**
 * Finds active content in a PDF (KTD22): JavaScript; additional actions (`/AA`), which run on
 * page, field or document events; launch, remote go-to (`GoToR`), embedded go-to, submit and
 * import actions; embedded files; rich media, renditions, movies and sounds; XFA forms; and a
 * web address (`URI`) opened when the document opens. A link the reader must click to a web
 * address is not active content. Such a PDF is flagged and never served.
 *
 * The keys that switch these on sit in dictionaries, either plain in the file or inside object
 * streams, which are decompressed under caps to be read. Any stream with `/ObjStm` or `/First`
 * counts as an object stream. A PDF whose object streams cannot be read exactly (encrypted, a
 * filter other than Flate alone, predictor parameters, a stream without its object header, or
 * beyond the caps) is `uninspectable`, which fails closed like active content.
 */

export type PdfInspection =
  | { readonly kind: 'passive' }
  | { readonly kind: 'active'; readonly marker: string }
  | { readonly kind: 'uninspectable' };

const activeNames = new Set([
  'JavaScript',
  'JS',
  'AA',
  'Launch',
  'GoToR',
  'GoToE',
  'SubmitForm',
  'ImportData',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'Rendition',
  'Movie',
  'Sound',
  'XFA',
]);

/** Parameters that change the decompressed bytes after Flate, so a plain inflate would misread them. */
const decodeParameterNames = ['DecodeParms', 'DP', 'Predictor'];

export interface PdfInspectionLimits {
  readonly maximumStreamBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumObjectStreams: number;
}

export const defaultPdfInspectionLimits: PdfInspectionLimits = {
  maximumStreamBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
  maximumObjectStreams: 10_000,
};

const namePattern = /\/([^\s/<>[\]()%{}]{1,127})/g;

/** A name as the PDF spells it may escape any character as `#xx` (PDF 32000-1, 7.3.5). */
function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** The text with every name spelled out, so later patterns need not know the escapes. */
function withDecodedNames(text: string): string {
  return text.replace(namePattern, (_name, raw: string) => `/${decodeName(raw)}`);
}

function namesIn(text: string): Set<string> {
  return new Set([...text.matchAll(namePattern)].map((match) => decodeName(match[1] ?? '')));
}

function activeNameIn(text: string): string | null {
  for (const name of namesIn(text)) {
    if (activeNames.has(name)) {
      return name;
    }
  }
  return null;
}

function streamDataStart(text: string, keyword: number): number {
  const afterKeyword = keyword + 'stream'.length;
  if (text.startsWith('\r\n', afterKeyword)) {
    return afterKeyword + 2;
  }
  return text.startsWith('\n', afterKeyword) || text.startsWith('\r', afterKeyword) ? afterKeyword + 1 : -1;
}

function integerAfter(dictionary: string, name: string): number | null {
  const match = new RegExp(`/${name}\\s+(\\d+)`).exec(dictionary);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The objects an object stream holds, by object number (PDF 32000-1, 7.5.7). */
function objectsOf(inflated: string, count: number, first: number): Map<number, string> | null {
  const header = inflated.slice(0, first).trim().split(/\s+/).map(Number);
  if (header.length !== count * 2 || header.some((value) => !Number.isInteger(value) || value < 0)) {
    return null;
  }
  const objects = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const number = header[index * 2] ?? 0;
    const start = first + (header[index * 2 + 1] ?? 0);
    const end = index + 1 < count ? first + (header[index * 2 + 3] ?? 0) : inflated.length;
    objects.set(number, inflated.slice(start, end));
  }
  return objects;
}

const objectHeaderPattern = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g;

/** The text of a plain object, from its header to its `endobj`. */
function plainObject(text: string, number: number): string | null {
  const header = new RegExp(`(?<![0-9])${number}\\s+\\d+\\s+obj\\b`).exec(text);
  if (header === null) {
    return null;
  }
  const end = text.indexOf('endobj', header.index);
  return text.slice(header.index, end === -1 ? text.length : end);
}

/**
 * Whether the document opens a web address when it opens: `/OpenAction` whose action, inline
 * or by reference, is a `URI` action. `/AA` is flagged outright, so its targets need no look.
 */
function opensWebAddress(sources: readonly string[], streamed: ReadonlyMap<number, string>): boolean | null {
  for (const source of sources) {
    for (const match of source.matchAll(/\/OpenAction\s*(?:(\d+)\s+\d+\s+R|(<<))/g)) {
      if (match[2] !== undefined) {
        const inline = source.slice(match.index, source.indexOf('>>', match.index));
        if (namesIn(inline).has('URI')) {
          return true;
        }
        continue;
      }
      const number = Number(match[1]);
      const target =
        streamed.get(number) ?? sources.map((text) => plainObject(text, number)).find((found) => found !== null);
      if (target === undefined) {
        return null;
      }
      if (namesIn(target).has('URI')) {
        return true;
      }
    }
  }
  return false;
}

export function inspectPdf(content: Buffer, limits: PdfInspectionLimits = defaultPdfInspectionLimits): PdfInspection {
  const raw = content.toString('latin1');
  const text = withDecodedNames(raw);
  const plain = activeNameIn(text);
  if (plain !== null) {
    return { kind: 'active', marker: plain };
  }
  const encrypted = namesIn(text).has('Encrypt');
  const headers = [...raw.matchAll(objectHeaderPattern)].map((match) => match.index);
  const inflatedTexts: string[] = [];
  const streamed = new Map<number, string>();
  let inflatedTotal = 0;
  let objectStreams = 0;
  let consumedUntil = 0;
  let nextHeader = 0;
  for (const match of raw.matchAll(/(?<![a-zA-Z])stream(?=\r?\n|\r)/g)) {
    const keyword = match.index;
    if (keyword < consumedUntil) {
      continue;
    }
    const start = streamDataStart(raw, keyword);
    const end = raw.indexOf('endstream', start);
    while (nextHeader < headers.length && (headers[nextHeader] ?? keyword) < keyword) {
      nextHeader += 1;
    }
    const header = nextHeader === 0 ? undefined : headers[nextHeader - 1];
    if (start === -1 || end === -1 || header === undefined) {
      return { kind: 'uninspectable' };
    }
    consumedUntil = end;
    const dictionary = withDecodedNames(raw.slice(header, keyword));
    const names = namesIn(dictionary);
    if (!names.has('ObjStm') && !names.has('First')) {
      continue;
    }
    objectStreams += 1;
    if (encrypted || objectStreams > limits.maximumObjectStreams) {
      return { kind: 'uninspectable' };
    }
    const filters = [...names].filter((name) => name.endsWith('Decode'));
    if (filters.length !== 1 || filters[0] !== 'FlateDecode' || decodeParameterNames.some((name) => names.has(name))) {
      return { kind: 'uninspectable' };
    }
    const count = integerAfter(dictionary, 'N');
    const first = integerAfter(dictionary, 'First');
    if (count === null || first === null) {
      return { kind: 'uninspectable' };
    }
    let inflated: string;
    try {
      const bytes = inflateSync(content.subarray(start, end), {
        maxOutputLength: Math.min(limits.maximumStreamBytes, limits.maximumTotalBytes - inflatedTotal),
      });
      inflatedTotal += bytes.byteLength;
      inflated = withDecodedNames(bytes.toString('latin1'));
    } catch {
      return { kind: 'uninspectable' };
    }
    const hidden = activeNameIn(inflated);
    if (hidden !== null) {
      return { kind: 'active', marker: hidden };
    }
    const objects = objectsOf(inflated, count, first);
    if (objects === null) {
      return { kind: 'uninspectable' };
    }
    inflatedTexts.push(inflated);
    for (const [number, body] of objects) {
      streamed.set(number, body);
    }
  }
  const opens = opensWebAddress([text, ...inflatedTexts], streamed);
  if (opens === null) {
    return { kind: 'uninspectable' };
  }
  return opens ? { kind: 'active', marker: 'URI' } : { kind: 'passive' };
}
