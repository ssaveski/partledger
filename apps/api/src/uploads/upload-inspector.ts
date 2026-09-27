import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

import { uploadSizeCaps, xlsxMediaType, csvMediaType, type UploadMediaType } from '@partledger/contracts';

import { headAgreesWith, headLength } from './magic-bytes';
import { TextContentCheck } from './text-content';
import { readZipDirectory, workbookShapeOf } from './zip-directory';

/** Why an upload was refused while it streamed. */
export type StreamRefusal = 'uploadTooLarge' | 'uploadContentMismatch';

export class UploadRefusedError extends Error {
  readonly reason: StreamRefusal;

  constructor(reason: StreamRefusal) {
    super(`The upload was refused while it streamed: ${reason}`);
    this.name = 'UploadRefusedError';
    this.reason = reason;
  }
}

/**
 * How much of a workbook's end an upload keeps: its central directory must fit, which a
 * spreadsheet's does many times over, and nothing more stays in memory.
 */
const workbookTailBytes = 1024 * 1024 + 64 * 1024;

/** A workbook with more entries than this is not a spreadsheet anyone imports. */
export const maximumWorkbookEntries = 2_000;

export interface InspectedContent {
  readonly sizeBytes: number;
  readonly contentHash: string;
}

/**
 * Sits between the request and quarantine (KTD22): it passes the bytes on while it counts,
 * hashes and checks them, and fails the stream the moment the file goes over its cap or its
 * content disagrees with the declared type, so the storage write aborts and leaves nothing.
 */
export class UploadInspector extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private readonly cap: number;
  private readonly text: TextContentCheck | null;
  private size = 0;
  private head: Buffer = Buffer.alloc(0);
  private headChecked = false;
  private tail: Buffer = Buffer.alloc(0);
  private inspected: InspectedContent | null = null;

  constructor(private readonly declared: UploadMediaType) {
    super();
    this.cap = uploadSizeCaps[declared];
    this.text = declared === csvMediaType ? new TextContentCheck() : null;
  }

  /** The size and SHA-256 of everything that passed, once the stream has ended without refusal. */
  get result(): InspectedContent | null {
    return this.inspected;
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (!(chunk instanceof Buffer)) {
      callback(new UploadRefusedError('uploadContentMismatch'));
      return;
    }
    this.size += chunk.byteLength;
    if (this.size > this.cap) {
      callback(new UploadRefusedError('uploadTooLarge'));
      return;
    }
    if (!this.headChecked) {
      this.head = Buffer.concat([this.head, chunk.subarray(0, headLength - this.head.byteLength)]);
      if (this.head.byteLength >= headLength) {
        this.headChecked = true;
        if (!headAgreesWith(this.declared, this.head)) {
          callback(new UploadRefusedError('uploadContentMismatch'));
          return;
        }
      }
    }
    if (this.text !== null && !this.text.push(chunk)) {
      callback(new UploadRefusedError('uploadContentMismatch'));
      return;
    }
    if (this.declared === xlsxMediaType) {
      const joined = Buffer.concat([this.tail, chunk]);
      this.tail =
        joined.byteLength > workbookTailBytes ? joined.subarray(joined.byteLength - workbookTailBytes) : joined;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    const refusal = this.finalCheck();
    if (refusal !== null) {
      callback(new UploadRefusedError(refusal));
      return;
    }
    this.inspected = { sizeBytes: this.size, contentHash: this.hash.digest('hex') };
    callback();
  }

  private finalCheck(): StreamRefusal | null {
    if (this.size === 0) {
      return 'uploadContentMismatch';
    }
    if (!this.headChecked && !headAgreesWith(this.declared, this.head)) {
      return 'uploadContentMismatch';
    }
    if (this.text !== null && !this.text.finish()) {
      return 'uploadContentMismatch';
    }
    if (this.declared === xlsxMediaType) {
      const directory = readZipDirectory(this.tail, this.size, { maximumEntries: maximumWorkbookEntries });
      if (!directory.ok || workbookShapeOf(directory.entries) !== 'workbook') {
        return 'uploadContentMismatch';
      }
    }
    return null;
  }
}
