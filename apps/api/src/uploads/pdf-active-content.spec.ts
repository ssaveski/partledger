import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { syntheticPdf } from '../../test/support/synthetic-files';
import { inspectPdf } from './pdf-active-content';

function objectStream(content: string, dictionary = '/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode'): Buffer {
  const data = deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.7\n7 0 obj\n<< ${dictionary} /Length ${data.byteLength} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}

describe('PDF active content', () => {
  it('passes a PDF without scripts, actions or embedded files', () => {
    expect(inspectPdf(syntheticPdf({ streamText: 'BT /F1 12 Tf (Synthetic certificate) Tj ET' }))).toEqual({
      kind: 'passive',
    });
  });

  it('finds embedded JavaScript, however its name is spelled', () => {
    expect(inspectPdf(syntheticPdf({ javascript: 'plain' }))).toEqual({ kind: 'active', marker: 'JavaScript' });
    expect(inspectPdf(syntheticPdf({ javascript: 'escapedName' }))).toEqual({ kind: 'active', marker: 'JavaScript' });
  });

  it('finds JavaScript hidden in a compressed object stream', () => {
    expect(inspectPdf(syntheticPdf({ javascript: 'objectStream' }))).toEqual({ kind: 'active', marker: 'JavaScript' });
  });

  it('finds launch actions, embedded files, XFA forms and additional actions', () => {
    for (const [dictionary, marker] of [
      ['<< /S /Launch /F (synthetic.exe) >>', 'Launch'],
      ['<< /Type /EmbeddedFile /Length 0 >>', 'EmbeddedFile'],
      ['<< /Fields [] /XFA 9 0 R >>', 'XFA'],
      ['<< /Type /Annot /AA << /E 9 0 R >> >>', 'AA'],
    ] as const) {
      const pdf = Buffer.from(`%PDF-1.7\n8 0 obj\n${dictionary}\nendobj\n%%EOF\n`, 'latin1');
      expect(inspectPdf(pdf)).toEqual({ kind: 'active', marker });
    }
  });

  it('fails closed on object streams it cannot read', () => {
    expect(inspectPdf(objectStream('4 0 << >>', '/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode'))).toEqual({
      kind: 'uninspectable',
    });
    const encrypted = Buffer.concat([
      objectStream('4 0 << >>'),
      Buffer.from('trailer\n<< /Encrypt 9 0 R >>\n', 'latin1'),
    ]);
    expect(inspectPdf(encrypted)).toEqual({ kind: 'uninspectable' });
  });

  it('fails closed on an object stream that inflates past its cap', () => {
    const bomb = objectStream(`4 0 << >>${' '.repeat(2 * 1024 * 1024)}`);
    expect(
      inspectPdf(bomb, { maximumStreamBytes: 1024 * 1024, maximumTotalBytes: 1024 * 1024, maximumObjectStreams: 10 }),
    ).toEqual({ kind: 'uninspectable' });
    expect(inspectPdf(objectStream('4 0 << /Type /Font >>'))).toEqual({ kind: 'passive' });
  });
});

const hiddenScript = "4 0 << /S /JavaScript /JS (app.alert\\('synthetic'\\)) >>";

/** PNG row filters (PNG 9.2) over rows of `columns` bytes, each row prefixed by its filter type. */
function pngPredicted(data: Buffer, columns: number, filter: 'none' | 'up'): Buffer {
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(columns);
  for (let offset = 0; offset < data.byteLength; offset += columns) {
    const row = Buffer.alloc(columns);
    data.copy(row, 0, offset, Math.min(offset + columns, data.byteLength));
    const encoded =
      filter === 'none' ? row : Buffer.from(row.map((byte, index) => (byte - (previous[index] ?? 0)) & 0xff));
    rows.push(Buffer.from([filter === 'none' ? 0 : 2]), encoded);
    previous = row;
  }
  return Buffer.concat(rows);
}

/** TIFF predictor 2 with one 8-bit colour: each byte as its difference from the one before it in the row. */
function tiffPredicted(data: Buffer, columns: number): Buffer {
  return Buffer.from(
    data.map((byte, index) => (index % columns === 0 ? byte : (byte - (data[index - 1] ?? 0)) & 0xff)),
  );
}

function rawObjectStream(encoded: Buffer, dictionary: string): Buffer {
  const data = deflateSync(encoded);
  return Buffer.concat([
    Buffer.from(`%PDF-1.7\n7 0 obj\n<< ${dictionary} /Length ${data.byteLength} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}

function pdfOf(...objects: readonly string[]): Buffer {
  return Buffer.from(`%PDF-1.7\n${objects.join('')}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

describe('PDF object streams the inspector cannot misread', () => {
  it('a PDF whose object stream uses a PNG predictor is not passed as passive', () => {
    const script = Buffer.from(hiddenScript, 'latin1');
    const base = '/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode';
    const predicted = [
      rawObjectStream(pngPredicted(script, 5, 'up'), `${base} /DecodeParms << /Predictor 12 /Columns 5 >>`),
      rawObjectStream(pngPredicted(script, 5, 'none'), `${base} /DecodeParms << /Predictor 10 /Columns 5 >>`),
      rawObjectStream(tiffPredicted(script, 5), `${base} /DecodeParms << /Predictor 2 /Columns 5 >>`),
    ];
    for (const pdf of predicted) {
      expect(inspectPdf(pdf).kind).not.toBe('passive');
    }
  });

  it('an object stream whose dictionary is padded past 4 KiB is still inspected', () => {
    const padded = `/Type /ObjStm${' '.repeat(5_000)}/N 1 /First 4 /Filter /FlateDecode`;
    expect(inspectPdf(objectStream(hiddenScript, padded))).toEqual({ kind: 'active', marker: 'JavaScript' });
  });

  it('an object stream without /Type /ObjStm is still inspected', () => {
    expect(inspectPdf(objectStream(hiddenScript, '/N 1 /First 4 /Filter /FlateDecode'))).toEqual({
      kind: 'active',
      marker: 'JavaScript',
    });
  });

  it('a stream whose object header cannot be found is uninspectable', () => {
    const data = deflateSync(Buffer.from(hiddenScript, 'latin1'));
    const headless = Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.byteLength} >>\nstream\n`,
      ),
      data,
      Buffer.from('\nendstream\n%%EOF\n'),
    ]);
    expect(inspectPdf(headless)).toEqual({ kind: 'uninspectable' });
  });
});

describe('PDF actions', () => {
  it('a PDF that opens a remote file on open is flagged', () => {
    const pdf = pdfOf(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /GoToR /F (remote-synthetic.pdf) /D [0 /Fit] >> >>\nendobj\n',
    );
    expect(inspectPdf(pdf)).toEqual({ kind: 'active', marker: 'GoToR' });
  });

  it('a PDF that plays media or sound is flagged', () => {
    for (const [action, marker] of [
      ['<< /S /Rendition /R 9 0 R >>', 'Rendition'],
      ['<< /S /Movie /T (synthetic) >>', 'Movie'],
      ['<< /S /Sound /Sound 9 0 R >>', 'Sound'],
    ] as const) {
      expect(inspectPdf(pdfOf(`8 0 obj\n${action}\nendobj\n`))).toEqual({ kind: 'active', marker });
    }
  });

  it('a PDF that opens a web address when it opens is flagged, inline or by reference', () => {
    const inline = pdfOf(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /URI /URI (https://synthetic.example.test/) >> >>\nendobj\n',
    );
    expect(inspectPdf(inline)).toEqual({ kind: 'active', marker: 'URI' });
    const referenced = pdfOf(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 9 0 R >>\nendobj\n',
      '9 0 obj\n<< /S /URI /URI (https://synthetic.example.test/) >>\nendobj\n',
    );
    expect(inspectPdf(referenced)).toEqual({ kind: 'active', marker: 'URI' });
    const inObjectStream = Buffer.concat([
      pdfOf('1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>\nendobj\n'),
      objectStream('4 0 << /S /URI /URI (https://synthetic.example.test/) >>'),
    ]);
    expect(inspectPdf(inObjectStream)).toEqual({ kind: 'active', marker: 'URI' });
  });

  it('a plain link annotation to a web address is not flagged', () => {
    const pdf = pdfOf(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>\nendobj\n',
      '5 0 obj\n<< /Type /Annot /Subtype /Link /Rect [0 0 100 20] /A << /S /URI /URI (https://synthetic.example.test/verify) >> >>\nendobj\n',
    );
    expect(inspectPdf(pdf)).toEqual({ kind: 'passive' });
  });
});
