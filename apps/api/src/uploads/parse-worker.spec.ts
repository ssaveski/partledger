import { describe, expect, it } from 'vitest';

import {
  binaryBytes,
  contentTypesXml,
  macroEnabledWorkbook,
  sheetXml,
  syntheticRows,
  syntheticWorkbook,
  workbookParts,
  zipOf,
  type ZipPart,
} from '../../test/support/synthetic-files';
import { parseSpreadsheet } from './parse-worker';

const mebibyte = 1024 * 1024;

function withSheet(content: string | Buffer, options: Omit<ZipPart, 'name' | 'content'> = {}): Buffer {
  return zipOf(
    workbookParts(syntheticRows).map((part) =>
      part.name === 'xl/worksheets/sheet1.xml' ? { name: part.name, content, ...options } : part,
    ),
  );
}

/** A sheet padded with whitespace, which deflates to almost nothing. */
function paddedSheet(bytes: number): Buffer {
  const sheet = sheetXml(syntheticRows);
  const split = sheet.indexOf('<sheetData>');
  return Buffer.concat([
    Buffer.from(sheet.slice(0, split)),
    Buffer.alloc(bytes, 0x20),
    Buffer.from(sheet.slice(split)),
  ]);
}

describe('the parse worker', () => {
  it('reads the rows of a workbook', async () => {
    expect(await parseSpreadsheet(syntheticWorkbook(), 'xlsx')).toEqual({
      ok: true,
      value: [{ name: 'Parts', rows: syntheticRows }],
    });
  });

  it('reads the rows of a CSV import, with quoted fields and a byte order mark', async () => {
    const csv = Buffer.from('﻿Part number,Description\r\nSYN-1001,"Synthetic bracket, ""anodised"""\n\n', 'utf8');
    expect(await parseSpreadsheet(csv, 'csv')).toEqual({
      ok: true,
      value: [
        {
          name: 'csv',
          rows: [
            ['Part number', 'Description'],
            ['SYN-1001', 'Synthetic bracket, "anodised"'],
          ],
        },
      ],
    });
  });

  it('stops an XLSX decompression bomb at its decompression cap', async () => {
    const bomb = withSheet(paddedSheet(80 * mebibyte));
    expect(bomb.byteLength).toBeLessThan(mebibyte);
    expect(await parseSpreadsheet(bomb, 'xlsx')).toEqual({ ok: false, error: 'decompressionLimit' });
  });

  it('stops a bomb whose directory understates its size once it inflates past the stated size', async () => {
    const lying = withSheet(paddedSheet(20 * mebibyte), { declaredSize: 4096 });
    expect(await parseSpreadsheet(lying, 'xlsx')).toEqual({ ok: false, error: 'decompressionLimit' });
  });

  it('stops a workbook whose parts together inflate past the total cap', async () => {
    const parts = [
      ...workbookParts(syntheticRows),
      ...Array.from({ length: 3 }, (_unused, index) => ({
        name: `xl/media/image${index}.png`,
        content: Buffer.alloc(600 * 1024, 0x41),
      })),
    ];
    expect(await parseSpreadsheet(zipOf(parts), 'xlsx', { limits: { maximumTotalBytes: mebibyte } })).toEqual({
      ok: false,
      error: 'decompressionLimit',
    });
  });

  it('refuses an XLSX whose XML declares a DTD', async () => {
    const withDoctype = withSheet(
      sheetXml(syntheticRows, { prolog: '<!DOCTYPE worksheet SYSTEM "http://127.0.0.1/synthetic.dtd">' }),
    );
    expect(await parseSpreadsheet(withDoctype, 'xlsx')).toEqual({ ok: false, error: 'dtdNotAllowed' });
  });

  it('refuses an XLSX carrying an entity-expansion payload', async () => {
    const entities = Array.from(
      { length: 9 },
      (_unused, level) => `<!ENTITY lol${level + 1} "${`&lol${level};`.repeat(10)}">`,
    ).join('');
    const payload = sheetXml([['&lol9;']], { prolog: `<!DOCTYPE lolz [<!ENTITY lol0 "lol">${entities}]>` });
    expect(await parseSpreadsheet(withSheet(payload), 'xlsx')).toEqual({ ok: false, error: 'dtdNotAllowed' });
  });

  it('refuses an XLSX part encoded as UTF-16', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sheetXml(syntheticRows), 'utf16le')]);
    expect(await parseSpreadsheet(withSheet(utf16), 'xlsx')).toEqual({ ok: false, error: 'encodingNotAllowed' });
  });

  it('refuses a macro-enabled workbook renamed to .xlsx, even when only its content types say so', async () => {
    expect(await parseSpreadsheet(macroEnabledWorkbook(), 'xlsx')).toEqual({ ok: false, error: 'macroEnabled' });
    const declaredOnly = zipOf(
      workbookParts(syntheticRows).map((part) =>
        part.name === '[Content_Types].xml'
          ? {
              ...part,
              content: contentTypesXml.replace('spreadsheetml.sheet.main+xml', 'ms-excel.sheet.macroEnabled.main+xml'),
            }
          : part,
      ),
    );
    expect(await parseSpreadsheet(declaredOnly, 'xlsx')).toEqual({ ok: false, error: 'macroEnabled' });
  });

  it('refuses a CSV import containing binary content', async () => {
    expect(await parseSpreadsheet(Buffer.concat([Buffer.from('SYN-1001,A\n'), binaryBytes]), 'csv')).toEqual({
      ok: false,
      error: 'notText',
    });
  });

  it('refuses more rows or columns than its limits allow', async () => {
    const rows = Buffer.from(Array.from({ length: 12 }, (_unused, index) => `SYN-${index},A`).join('\n'));
    expect(await parseSpreadsheet(rows, 'csv', { limits: { maximumRows: 10 } })).toEqual({
      ok: false,
      error: 'tooManyRows',
    });
    expect(await parseSpreadsheet(syntheticWorkbook(), 'xlsx', { limits: { maximumColumns: 2 } })).toEqual({
      ok: false,
      error: 'tooManyColumns',
    });
  });

  it('stops a parse that runs past its time limit', async () => {
    expect(await parseSpreadsheet(syntheticWorkbook(), 'xlsx', { timeoutMilliseconds: 1 })).toEqual({
      ok: false,
      error: 'timeLimit',
    });
  });

  it('stops a parse that runs out of its memory limit', async () => {
    // About 40 MB of cell text: inside the decompression caps, far beyond a 16 MB heap.
    const rows = Array.from({ length: 40_000 }, (_unused, index) => [`SYN-${index}`, 'x'.repeat(1_000)]);
    expect(
      await parseSpreadsheet(syntheticWorkbook(rows), 'xlsx', { heapMegabytes: 16, timeoutMilliseconds: 60_000 }),
    ).toEqual({ ok: false, error: 'memoryLimit' });
  });
});
