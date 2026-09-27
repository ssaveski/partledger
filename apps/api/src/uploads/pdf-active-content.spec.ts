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
