import { fork } from 'node:child_process';

import { failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import type { ParseLimits, ParseRequest } from './parse-worker.process';

/**
 * Parses an import file in a resource-capped child process (KTD22, KTD26), for U12's imports.
 * The process runs with a small V8 heap, no environment and no secrets, and is killed at the
 * time limit, so a spreadsheet built to exhaust memory or time costs that process, never the
 * API. A process rather than a worker thread, because V8 does not hold a worker thread to its
 * heap limit on Node 24. Its reply is parsed like any other untrusted input.
 */

export type { ParseLimits } from './parse-worker.process';

export const parseFormats = ['xlsx', 'csv'] as const;

export type ParseFormat = (typeof parseFormats)[number];

export const defaultParseLimits: ParseLimits = {
  maximumEntryBytes: 50 * 1024 * 1024,
  maximumTotalBytes: 100 * 1024 * 1024,
  maximumCompressionRatio: 200,
  maximumEntries: 2_000,
  maximumRows: 100_000,
  maximumColumns: 500,
  maximumCellLength: 32_767,
};

export interface ParseWorkerOptions {
  readonly limits?: Partial<ParseLimits>;
  readonly timeoutMilliseconds?: number;
  /** The process's old-generation heap; the strings and rows the parser builds count against it. */
  readonly heapMegabytes?: number;
}

export const parseRefusals = [
  'notWorkbook',
  'macroEnabled',
  'externalContent',
  'malformedArchive',
  'decompressionLimit',
  'dtdNotAllowed',
  'encodingNotAllowed',
  'notText',
  'unparseable',
  'tooManyRows',
  'tooManyColumns',
  'cellTooLong',
  'memoryLimit',
  'timeLimit',
] as const;

export type ParseRefusal = (typeof parseRefusals)[number];

const parsedSheetsSchema = z.array(
  z.object({ name: z.string().max(255), rows: z.array(z.array(z.string())) }).strict(),
);

const replySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), sheets: parsedSheetsSchema }).strict(),
  z.object({ ok: z.literal(false), problem: z.enum(parseRefusals) }).strict(),
]);

export type ParsedSpreadsheet = z.infer<typeof parsedSheetsSchema>;

/**
 * The process's entry: its TypeScript source, which Node runs by stripping its types, while
 * tests run from source; the bundle's `parse-worker.process.js` beside `main.js` in a build
 * (apps/api/vite.config.ts).
 */
function processEntry(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./parse-worker.process.ts', import.meta.url)
    : new URL('./parse-worker.process.js', import.meta.url);
}

export function parseSpreadsheet(
  bytes: Uint8Array,
  format: ParseFormat,
  options: ParseWorkerOptions = {},
): Promise<Result<ParsedSpreadsheet, ParseRefusal>> {
  const request: ParseRequest = { format, bytes, limits: { ...defaultParseLimits, ...options.limits } };
  const heap = options.heapMegabytes ?? 256;
  return new Promise((resolve) => {
    let settled = false;
    const child = fork(processEntry(), [], {
      execArgv: [`--max-old-space-size=${heap}`],
      // The process sees no configuration and no secrets.
      env: {},
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const finish = (outcome: Result<ParsedSpreadsheet, ParseRefusal>) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        resolve(outcome);
      }
    };
    const timer = setTimeout(() => {
      finish(failure('timeLimit'));
    }, options.timeoutMilliseconds ?? 30_000);
    child.once('message', (message: unknown) => {
      const reply = replySchema.safeParse(message);
      if (!reply.success) {
        finish(failure('unparseable'));
      } else {
        finish(reply.data.ok ? success(reply.data.sheets) : failure(reply.data.problem));
      }
    });
    child.once('error', () => {
      finish(failure('unparseable'));
    });
    // V8 aborts a process that exhausts its heap.
    child.once('exit', (code, signal) => {
      finish(failure(signal === 'SIGABRT' || code === 134 ? 'memoryLimit' : 'unparseable'));
    });
    child.send(request);
  });
}
