import { connect, type Socket } from 'node:net';

import type { MalwareScanner, ScanVerdict } from './malware-scanner.port';

export interface ClamdSettings {
  readonly host: string;
  readonly port: number;
  /** How long one scan may take, connection included, before the scanner counts as unavailable. */
  readonly timeoutMilliseconds: number;
}

/** clamd reads INSTREAM data in chunks, each preceded by its length as a 4-byte big-endian integer. */
const chunkBytes = 64 * 1024;

/** A signature name as clamd reports it, such as `Win.Test.EICAR_HDB-1`. */
const signaturePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

/**
 * Interprets clamd's one-line reply to INSTREAM. With `AlertExceedsMax yes`, content beyond a
 * scan limit is reported as `Heuristics.Limits.Exceeded.*`, and a stream longer than
 * `StreamMaxLength` is refused outright; both fail closed as `limitsExceeded`. Any other error
 * leaves the file pending.
 */
export function verdictOf(reply: string): ScanVerdict {
  const line = reply.replace(/\0+$/, '').trim();
  if (line === 'stream: OK') {
    return { kind: 'clean' };
  }
  const found = /^stream: (.+) FOUND$/.exec(line);
  if (found !== null) {
    const name = found[1] ?? '';
    const signature = signaturePattern.test(name) ? name : 'Unknown.Signature';
    return signature.startsWith('Heuristics.Limits.Exceeded')
      ? { kind: 'limitsExceeded', signature }
      : { kind: 'infected', signature };
  }
  if (/^INSTREAM size limit exceeded\b/.test(line)) {
    return { kind: 'limitsExceeded', signature: 'Clamd.StreamMaxLength.Exceeded' };
  }
  return { kind: 'unavailable' };
}

/**
 * The scanner port on clamd (KTD22): the file is streamed with INSTREAM over TCP to the
 * region's clamd on the private network, and nothing leaves the region. clamd's own limits
 * (`infra/compose/clamd/clamd.conf`) are small, and it alerts when they are exceeded.
 */
export class ClamdScanner implements MalwareScanner {
  constructor(private readonly settings: ClamdSettings) {}

  scan(content: Buffer): Promise<ScanVerdict> {
    return new Promise((resolve) => {
      let settled = false;
      let reply = '';
      const socket: Socket = connect({ host: this.settings.host, port: this.settings.port });
      const finish = (verdict: ScanVerdict) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(verdict);
        }
      };
      const timer = setTimeout(() => {
        finish({ kind: 'unavailable' });
      }, this.settings.timeoutMilliseconds);
      socket.setEncoding('latin1');
      // clamd answers and closes when it refuses a stream, so a write may fail after its reply arrived.
      socket.on('error', () => {
        finish(reply === '' ? { kind: 'unavailable' } : verdictOf(reply));
      });
      socket.on('data', (data: string) => {
        reply += data;
        if (reply.includes('\0') || reply.length > 4096) {
          finish(verdictOf(reply));
        }
      });
      socket.on('end', () => {
        finish(reply === '' ? { kind: 'unavailable' } : verdictOf(reply));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < content.byteLength; offset += chunkBytes) {
          const chunk = content.subarray(offset, offset + chunkBytes);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.byteLength);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}
