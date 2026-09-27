import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamdScanner, verdictOf } from './clamd.adapter';
import { eicarTestFile } from './malware-scanner.port';

/** Speaks just enough of clamd's INSTREAM protocol to answer as a test tells it to. */
function fakeClamd(answer: (content: Buffer) => string | null): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buffered = Buffer.alloc(0);
      socket.on('data', (data: Buffer) => {
        buffered = Buffer.concat([buffered, data]);
        const command = 'zINSTREAM\0';
        if (buffered.byteLength < command.length) {
          return;
        }
        const chunks: Buffer[] = [];
        let offset = command.length;
        while (offset + 4 <= buffered.byteLength) {
          const length = buffered.readUInt32BE(offset);
          if (length === 0) {
            const reply = answer(Buffer.concat(chunks));
            if (reply !== null) {
              socket.end(`${reply}\0`);
            }
            return;
          }
          if (offset + 4 + length > buffered.byteLength) {
            return;
          }
          chunks.push(buffered.subarray(offset + 4, offset + 4 + length));
          offset += 4 + length;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function scannerFor(answer: (content: Buffer) => string | null, timeoutMilliseconds = 2_000) {
  const server = await fakeClamd(answer);
  servers.push(server);
  const address = server.address();
  const { port } =
    typeof address === 'object' && address !== null ? address : ({ port: 0 } satisfies Pick<AddressInfo, 'port'>);
  return new ClamdScanner({ host: '127.0.0.1', port, timeoutMilliseconds });
}

describe('clamd replies', () => {
  it('are clean only when clamd says OK', () => {
    expect(verdictOf('stream: OK\0')).toEqual({ kind: 'clean' });
    expect(verdictOf('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      kind: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('flag content beyond the scan limits like an infection, never as clean', () => {
    expect(verdictOf('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0')).toEqual({
      kind: 'limitsExceeded',
      signature: 'Heuristics.Limits.Exceeded.MaxFileSize',
    });
    expect(verdictOf('INSTREAM size limit exceeded. ERROR\0')).toEqual({
      kind: 'limitsExceeded',
      signature: 'Clamd.StreamMaxLength.Exceeded',
    });
  });

  it('leave the file pending on any other error', () => {
    expect(verdictOf("stream: Can't allocate memory ERROR\0")).toEqual({ kind: 'unavailable' });
    expect(verdictOf('')).toEqual({ kind: 'unavailable' });
  });
});

describe('the clamd scanner', () => {
  it('streams the whole file in length-prefixed chunks', async () => {
    const received: Buffer[] = [];
    const scanner = await scannerFor((content) => {
      received.push(content);
      return content.includes(eicarTestFile) ? 'stream: Win.Test.EICAR_HDB-1 FOUND' : 'stream: OK';
    });
    const large = Buffer.alloc(200 * 1024, 0x61);
    expect(await scanner.scan(large)).toEqual({ kind: 'clean' });
    expect(received[0]?.equals(large)).toBe(true);
    expect(await scanner.scan(Buffer.from(eicarTestFile))).toEqual({
      kind: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('is unavailable when clamd refuses the connection or does not answer in time', async () => {
    const closed = await fakeClamd(() => null);
    const address = closed.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise((resolve) => closed.close(resolve));
    expect(
      await new ClamdScanner({ host: '127.0.0.1', port, timeoutMilliseconds: 2_000 }).scan(Buffer.from('x')),
    ).toEqual({ kind: 'unavailable' });
    const silent = await scannerFor(() => null, 300);
    expect(await silent.scan(Buffer.from('x'))).toEqual({ kind: 'unavailable' });
  });
});
