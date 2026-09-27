import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  csvMediaType,
  jpegMediaType,
  pdfMediaType,
  pngMediaType,
  uploadSizeCaps,
  xlsxMediaType,
  type UploadMediaType,
} from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import {
  binaryBytes,
  macroEnabledWorkbook,
  syntheticPdf,
  syntheticPng,
  syntheticWorkbook,
  workbookParts,
  zipOf,
} from '../../test/support/synthetic-files';
import { extensionAgreesWith, headAgreesWith, sniffKind } from './magic-bytes';
import { TextContentCheck } from './text-content';
import { UploadInspector, UploadRefusedError } from './upload-inspector';
import { readZipDirectory, workbookShapeOf } from './zip-directory';

async function inspect(
  mediaType: UploadMediaType,
  chunks: readonly Buffer[],
): Promise<{ readonly passed: number; readonly inspector: UploadInspector; readonly error: unknown }> {
  const inspector = new UploadInspector(mediaType);
  let passed = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      passed += chunk.byteLength;
      callback();
    },
  });
  try {
    await pipeline(Readable.from(chunks), inspector, sink);
    return { passed, inspector, error: null };
  } catch (error) {
    return { passed, inspector, error };
  }
}

function refusalOf(error: unknown): string | null {
  return error instanceof UploadRefusedError ? error.reason : null;
}

describe('magic bytes', () => {
  it('recognise PDF, PNG, JPEG and ZIP by their first bytes and nothing else', () => {
    expect(sniffKind(syntheticPdf())).toBe('pdf');
    expect(sniffKind(syntheticPng())).toBe('png');
    expect(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('jpeg');
    expect(sniffKind(syntheticWorkbook())).toBe('zip');
    expect(sniffKind(Buffer.from('Part number,Revision\n'))).toBeNull();
    expect(sniffKind(binaryBytes)).toBeNull();
  });

  it('refuse a binary declared as a PDF, a PDF declared as a PNG and a workbook declared as a CSV', () => {
    expect(headAgreesWith(pdfMediaType, binaryBytes)).toBe(false);
    expect(headAgreesWith(pngMediaType, syntheticPdf())).toBe(false);
    expect(headAgreesWith(csvMediaType, syntheticWorkbook())).toBe(false);
    expect(headAgreesWith(jpegMediaType, syntheticPng())).toBe(false);
  });

  it('accept each type whose content matches it', () => {
    expect(headAgreesWith(pdfMediaType, syntheticPdf())).toBe(true);
    expect(headAgreesWith(pngMediaType, syntheticPng())).toBe(true);
    expect(headAgreesWith(xlsxMediaType, syntheticWorkbook())).toBe(true);
    expect(headAgreesWith(csvMediaType, Buffer.from('SYN-1001,A\n'))).toBe(true);
  });

  it('require the file name extension to match the declared type', () => {
    expect(extensionAgreesWith(pdfMediaType, 'Certificate ISO 9001.PDF')).toBe(true);
    expect(extensionAgreesWith(jpegMediaType, 'scan.jpeg')).toBe(true);
    expect(extensionAgreesWith(jpegMediaType, 'scan.jpg')).toBe(true);
    expect(extensionAgreesWith(pdfMediaType, 'installer.exe')).toBe(false);
    expect(extensionAgreesWith(xlsxMediaType, 'parts.xlsm')).toBe(false);
    expect(extensionAgreesWith(csvMediaType, 'csv')).toBe(false);
    expect(extensionAgreesWith(csvMediaType, '.csv')).toBe(false);
  });
});

describe('the CSV text check', () => {
  it('accepts UTF-8 text even when a character is split across chunks', () => {
    const text = Buffer.from('Pièce,Révision\nSYN-1001,A\n', 'utf8');
    const check = new TextContentCheck();
    const split = text.indexOf(0xc3) + 1;
    expect(check.push(text.subarray(0, split))).toBe(true);
    expect(check.push(text.subarray(split))).toBe(true);
    expect(check.finish()).toBe(true);
  });

  it('refuses a NUL byte, other binary control characters, invalid UTF-8 and a truncated character', () => {
    for (const bytes of [
      Buffer.from('SYN-1001\u0000,A\n'),
      Buffer.from('SYN-1001\u0007,A\n'),
      Buffer.from([0x53, 0x59, 0x4e, 0xff, 0x0a]),
      binaryBytes,
    ]) {
      const check = new TextContentCheck();
      expect(check.push(bytes) && check.finish()).toBe(false);
    }
    const truncated = new TextContentCheck();
    expect(truncated.push(Buffer.from([0x41, 0xc3]))).toBe(true);
    expect(truncated.finish()).toBe(false);
  });
});

describe('the workbook check', () => {
  it('accepts a workbook and names a macro-enabled workbook as such', () => {
    const plain = syntheticWorkbook();
    const macro = macroEnabledWorkbook();
    const plainDirectory = readZipDirectory(plain, plain.byteLength, { maximumEntries: 100 });
    const macroDirectory = readZipDirectory(macro, macro.byteLength, { maximumEntries: 100 });
    expect(plainDirectory.ok && workbookShapeOf(plainDirectory.entries)).toBe('workbook');
    expect(macroDirectory.ok && workbookShapeOf(macroDirectory.entries)).toBe('macroEnabled');
  });

  it('refuses a ZIP that is not a workbook, one with an unsafe entry name and one with too many entries', () => {
    const other = zipOf([{ name: 'readme.txt', content: 'synthetic' }]);
    const otherDirectory = readZipDirectory(other, other.byteLength, { maximumEntries: 100 });
    expect(otherDirectory.ok && workbookShapeOf(otherDirectory.entries)).toBe('notWorkbook');
    const escaping = zipOf([...workbookParts([['A']]), { name: '../../etc/cron.d/synthetic', content: 'x' }]);
    expect(readZipDirectory(escaping, escaping.byteLength, { maximumEntries: 100 })).toEqual({
      ok: false,
      problem: 'unsafeName',
    });
    const workbook = syntheticWorkbook();
    expect(readZipDirectory(workbook, workbook.byteLength, { maximumEntries: 2 })).toEqual({
      ok: false,
      problem: 'tooManyEntries',
    });
  });
});

describe('the upload inspector', () => {
  it('passes a PDF through and reports its size and an independent SHA-256', async () => {
    const pdf = syntheticPdf();
    const { passed, inspector, error } = await inspect(pdfMediaType, [pdf.subarray(0, 3), pdf.subarray(3)]);
    expect(error).toBeNull();
    expect(passed).toBe(pdf.byteLength);
    expect(inspector.result).toEqual({
      sizeBytes: pdf.byteLength,
      contentHash: createHash('sha256').update(pdf).digest('hex'),
    });
  });

  it('refuses a binary renamed to .pdf at its first bytes, before anything is passed on', async () => {
    const { passed, error } = await inspect(pdfMediaType, [binaryBytes, Buffer.alloc(64 * 1024)]);
    expect(refusalOf(error)).toBe('uploadContentMismatch');
    expect(passed).toBe(0);
  });

  it('refuses a file over its cap mid-stream, before the rest arrives', async () => {
    const cap = uploadSizeCaps[pdfMediaType];
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const chunks = [syntheticPdf(), ...Array.from({ length: cap / chunk.byteLength + 4 }, () => chunk)];
    const { passed, error } = await inspect(pdfMediaType, chunks);
    expect(refusalOf(error)).toBe('uploadTooLarge');
    expect(passed).toBeLessThanOrEqual(cap);
  });

  it('refuses a CSV import containing binary content', async () => {
    const { error } = await inspect(csvMediaType, [Buffer.from('SYN-1001,A\n'), binaryBytes]);
    expect(refusalOf(error)).toBe('uploadContentMismatch');
  });

  it('refuses a macro-enabled workbook renamed to .xlsx, and an empty file', async () => {
    expect(refusalOf((await inspect(xlsxMediaType, [macroEnabledWorkbook()])).error)).toBe('uploadContentMismatch');
    expect(refusalOf((await inspect(pdfMediaType, [])).error)).toBe('uploadContentMismatch');
  });

  it('accepts a workbook whose central directory arrives in small chunks', async () => {
    const workbook = syntheticWorkbook();
    const chunks = Array.from({ length: Math.ceil(workbook.byteLength / 7) }, (_unused, index) =>
      workbook.subarray(index * 7, index * 7 + 7),
    );
    const { error, inspector } = await inspect(xlsxMediaType, chunks);
    expect(error).toBeNull();
    expect(inspector.result?.sizeBytes).toBe(workbook.byteLength);
  });

  it('refuses a workbook with an external link', async () => {
    const linked = zipOf([
      ...workbookParts([['A']]),
      { name: 'xl/externalLinks/externalLink1.xml', content: '<externalLink/>' },
    ]);
    expect(refusalOf((await inspect(xlsxMediaType, [linked])).error)).toBe('uploadContentMismatch');
  });
});
