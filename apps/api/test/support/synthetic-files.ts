import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

/**
 * Synthetic files for the upload pipeline's tests (U14): invented content only. ZIP containers
 * are written here byte by byte, so a test can build exactly the workbook it needs, including
 * the malformed and hostile ones no spreadsheet program would write.
 */

export interface ZipPart {
  readonly name: string;
  readonly content: Buffer | string;
  /** Stored rather than deflated. */
  readonly stored?: boolean;
  /** The uncompressed size the directory claims, when a test wants it to lie. */
  readonly declaredSize?: number;
}

export function zipOf(parts: readonly ZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const content = Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content, 'utf8');
    const data = part.stored === true ? content : deflateRawSync(content);
    const name = Buffer.from(part.name, 'utf8');
    const method = part.stored === true ? 0 : 8;
    const checksum = crc32(content);
    const size = part.declaredSize ?? content.byteLength;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function columnName(index: number): string {
  return String.fromCharCode(65 + index);
}

export function sheetXml(rows: readonly (readonly string[])[], options: { readonly prolog?: string } = {}): string {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (cell, cellIndex) =>
              `<c r="${columnName(cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  return `${xmlDeclaration}${options.prolog ?? ''}<worksheet xmlns="${spreadsheetNamespace}"><sheetData>${body}</sheetData></worksheet>`;
}

export const contentTypesXml = `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

/** The parts of a one-sheet workbook with synthetic rows; tests replace or add parts. */
export function workbookParts(rows: readonly (readonly string[])[]): ZipPart[] {
  return [
    { name: '[Content_Types].xml', content: contentTypesXml },
    {
      name: '_rels/.rels',
      content: `${xmlDeclaration}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationshipsNamespace}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `${xmlDeclaration}<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${relationshipsNamespace}"><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `${xmlDeclaration}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationshipsNamespace}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(rows) },
  ];
}

export const syntheticRows: readonly (readonly string[])[] = [
  ['Part number', 'Revision', 'Description'],
  ['SYN-1001', 'A', 'Synthetic bracket, anodised'],
  ['SYN-1002', 'C', 'Synthetic hinge pin, stainless'],
];

export function syntheticWorkbook(rows: readonly (readonly string[])[] = syntheticRows): Buffer {
  return zipOf(workbookParts(rows));
}

/** A workbook whose parts include a synthetic VBA project, as Excel saves a macro-enabled `.xlsm`. */
export function macroEnabledWorkbook(): Buffer {
  const parts = workbookParts(syntheticRows).map((part) =>
    part.name === '[Content_Types].xml'
      ? {
          ...part,
          content: contentTypesXml.replace(
            'spreadsheetml.sheet.main+xml',
            'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
          ),
        }
      : part,
  );
  return zipOf([...parts, { name: 'xl/vbaProject.bin', content: Buffer.from('synthetic VBA project bytes') }]);
}

/** Every byte a CSV may not hold: invalid UTF-8 and NUL, as a binary file renamed to `.csv` has. */
export const binaryBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x10]);

export interface SyntheticPdfOptions {
  /** An action that runs JavaScript when the document opens. */
  readonly javascript?: 'plain' | 'escapedName' | 'objectStream';
  /** Text placed in an uncompressed stream of the page. */
  readonly streamText?: string;
}

/** A minimal PDF with one blank page and synthetic content. */
export function syntheticPdf(options: SyntheticPdfOptions = {}): Buffer {
  const objects: Buffer[] = [];
  const openAction = options.javascript === undefined ? '' : ' /OpenAction 4 0 R';
  objects.push(Buffer.from(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R${openAction} >>\nendobj\n`, 'latin1'));
  objects.push(Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'));
  const contents = options.streamText === undefined ? '' : ' /Contents 5 0 R';
  objects.push(
    Buffer.from(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${contents} >>\nendobj\n`, 'latin1'),
  );
  if (options.javascript === 'plain') {
    objects.push(Buffer.from("4 0 obj\n<< /S /JavaScript /JS (app.alert\\('synthetic'\\)) >>\nendobj\n", 'latin1'));
  } else if (options.javascript === 'escapedName') {
    objects.push(Buffer.from("4 0 obj\n<< /S /J#61vaScript /J#53 (app.alert\\('synthetic'\\)) >>\nendobj\n", 'latin1'));
  } else if (options.javascript === 'objectStream') {
    const hidden = deflateSync(Buffer.from("4 0 << /S /JavaScript /JS (app.alert\\('synthetic'\\)) >>", 'latin1'));
    objects.push(
      Buffer.concat([
        Buffer.from(
          `6 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${hidden.byteLength} >>\nstream\n`,
        ),
        hidden,
        Buffer.from('\nendstream\nendobj\n'),
      ]),
    );
  }
  if (options.streamText !== undefined) {
    const text = Buffer.from(options.streamText, 'latin1');
    objects.push(
      Buffer.concat([
        Buffer.from(`5 0 obj\n<< /Length ${text.byteLength} >>\nstream\n`),
        text,
        Buffer.from('\nendstream\nendobj\n'),
      ]),
    );
  }
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1'),
    ...objects,
    Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}

/** A PNG signature followed by a synthetic header chunk; enough for the content check. */
export function syntheticPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('0000000dIHDRsynthetic', 'latin1'),
  ]);
}
