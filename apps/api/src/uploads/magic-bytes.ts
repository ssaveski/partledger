import {
  csvMediaType,
  jpegMediaType,
  pdfMediaType,
  pngMediaType,
  uploadExtensions,
  xlsxMediaType,
  type UploadMediaType,
} from '@partledger/contracts';

/**
 * Content checks by magic bytes (KTD22): an upload is accepted only when its declared type, its
 * file name and its content agree. The first bytes decide for documents and images; a
 * workbook must also be a ZIP whose directory names a workbook without macros (see
 * zip-directory.ts); a CSV must be UTF-8 text without NUL or other binary control characters
 * (see text-content.ts).
 */

export type SniffedKind = 'pdf' | 'png' | 'jpeg' | 'zip';

const signatures: readonly { readonly kind: SniffedKind; readonly bytes: readonly number[] }[] = [
  // `%PDF-`
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { kind: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  // A local file header, `PK\x03\x04`: the first entry of a ZIP container.
  { kind: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/** How many leading bytes `sniffKind` needs to decide. */
export const headLength = Math.max(...signatures.map((signature) => signature.bytes.length));

export function sniffKind(head: Uint8Array): SniffedKind | null {
  const match = signatures.find(
    (signature) =>
      head.byteLength >= signature.bytes.length && signature.bytes.every((byte, index) => head[index] === byte),
  );
  return match?.kind ?? null;
}

const expectedKinds: Readonly<Record<UploadMediaType, SniffedKind | 'text'>> = {
  [pdfMediaType]: 'pdf',
  [pngMediaType]: 'png',
  [jpegMediaType]: 'jpeg',
  [xlsxMediaType]: 'zip',
  [csvMediaType]: 'text',
};

/**
 * Whether the first bytes fit the declared type. Text has no signature, so a CSV passes here
 * unless it starts like one of the binary formats; `TextContentCheck` then reads all of it.
 */
export function headAgreesWith(declared: UploadMediaType, head: Uint8Array): boolean {
  const expected = expectedKinds[declared];
  const sniffed = sniffKind(head);
  return expected === 'text' ? sniffed === null : sniffed === expected;
}

/** Whether the file name's extension is one the declared type may carry, compared case-insensitively. */
export function extensionAgreesWith(declared: UploadMediaType, fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return false;
  }
  const extension = fileName.slice(dot + 1).toLowerCase();
  const allowed: readonly string[] = uploadExtensions[declared];
  return allowed.includes(extension);
}
