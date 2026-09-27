import { inflateSync } from 'node:zlib';

/**
 * Finds active content in a PDF (KTD22): scripts, actions that run on open or on events,
 * launch and submit actions, embedded files, rich media and XFA forms. Such a PDF is flagged
 * and never served. The keys that switch these on sit in dictionaries, which are either plain
 * in the file or inside object streams; object streams are decompressed under caps to be read.
 * A PDF whose object streams cannot be read (encrypted, an unexpected filter, or beyond the
 * caps) is `uninspectable`, which fails closed like active content.
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
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'XFA',
  'SubmitForm',
  'ImportData',
  'GoToE',
]);

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

function activeNameIn(text: string): string | null {
  for (const match of text.matchAll(namePattern)) {
    const name = decodeName(match[1] ?? '');
    if (activeNames.has(name)) {
      return name;
    }
  }
  return null;
}

function namesIn(text: string): Set<string> {
  return new Set([...text.matchAll(namePattern)].map((match) => decodeName(match[1] ?? '')));
}

function streamDataStart(text: string, keyword: number): number {
  const afterKeyword = keyword + 'stream'.length;
  if (text.startsWith('\r\n', afterKeyword)) {
    return afterKeyword + 2;
  }
  return text.startsWith('\n', afterKeyword) || text.startsWith('\r', afterKeyword) ? afterKeyword + 1 : -1;
}

export function inspectPdf(content: Buffer, limits: PdfInspectionLimits = defaultPdfInspectionLimits): PdfInspection {
  const text = content.toString('latin1');
  const plain = activeNameIn(text);
  if (plain !== null) {
    return { kind: 'active', marker: plain };
  }
  const encrypted = namesIn(text).has('Encrypt');
  let inflatedTotal = 0;
  let objectStreams = 0;
  for (const match of text.matchAll(/(?<![a-zA-Z])stream(?=\r?\n|\r)/g)) {
    const keyword = match.index;
    const window = text.slice(Math.max(0, keyword - 4096), keyword);
    const dictionary = window.slice(Math.max(0, window.lastIndexOf(' obj')));
    const names = namesIn(dictionary);
    if (!names.has('ObjStm')) {
      continue;
    }
    objectStreams += 1;
    if (encrypted || objectStreams > limits.maximumObjectStreams) {
      return { kind: 'uninspectable' };
    }
    const filters = [...names].filter((name) => name.endsWith('Decode'));
    if (filters.length !== 1 || filters[0] !== 'FlateDecode') {
      return { kind: 'uninspectable' };
    }
    const start = streamDataStart(text, keyword);
    const end = text.indexOf('endstream', start);
    if (start === -1 || end === -1) {
      return { kind: 'uninspectable' };
    }
    let inflated: Buffer;
    try {
      inflated = inflateSync(content.subarray(start, end), {
        maxOutputLength: Math.min(limits.maximumStreamBytes, limits.maximumTotalBytes - inflatedTotal),
      });
    } catch {
      return { kind: 'uninspectable' };
    }
    inflatedTotal += inflated.byteLength;
    const hidden = activeNameIn(inflated.toString('latin1'));
    if (hidden !== null) {
      return { kind: 'active', marker: hidden };
    }
  }
  return { kind: 'passive' };
}
