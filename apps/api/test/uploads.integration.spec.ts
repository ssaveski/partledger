import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import {
  csvMediaType,
  pdfMediaType,
  pngMediaType,
  staffRequestHeader,
  uploadAttestationHeader,
  uploadDownloadPath,
  uploadFileNameHeader,
  uploadPath,
  uploadReceiptSchema,
  uploadStatusSchema,
  xlsxMediaType,
  type UploadPurpose,
} from '@partledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { productionRegistry } from '../src/commands/query-registry';
import { JobItemFailedError, JobRunner, type DeliveredJob } from '../src/jobs/job-runner';
import type { HttpEntryAdapter } from '../src/listeners/entry-adapters';
import { eicarTestFile, type MalwareScanner } from '../src/uploads/malware-scanner.port';
import { credentialHeaders, startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';
import { jobsTestCatalogTables } from './support/jobs-test-module';
import {
  binaryBytes,
  macroEnabledWorkbook,
  sheetXml,
  syntheticPdf,
  syntheticPng,
  syntheticRows,
  syntheticWorkbook,
  workbookParts,
  zipOf,
} from './support/synthetic-files';
import { startClamd, startObjectStore, type StartedClamd, type StartedObjectStore } from './support/upload-services';

const mebibyte = 1024 * 1024;
const linkQuotaFiles = 3;

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

const errorBody = z.object({ error: z.string(), message: z.string() });
const uploadRows = z.array(
  z.object({
    tenant_id: z.uuid(),
    purpose: z.string(),
    media_type: z.string(),
    file_name: z.string(),
    size_bytes: z.coerce.number(),
    content_hash: z.string(),
    scan_status: z.enum(['pending', 'clean', 'flagged']),
    scan_finding: z.string().nullable(),
    scan_signature: z.string().nullable(),
    uploader_type: z.string(),
    credential_id: z.uuid(),
  }),
);
const jobRows = z.array(z.object({ id: z.uuid(), name: z.string(), data: z.unknown() }));
const auditRows = z.array(z.object({ actor_type: z.string(), payload: z.record(z.string(), z.unknown()) }));

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function json(response: RawResponse): unknown {
  return JSON.parse(response.body.toString('utf8'));
}

function messageOf(response: RawResponse): string {
  return errorBody.parse(json(response)).message;
}

/**
 * Sends a file over plain HTTP, chunk by chunk, and resolves with the response even when the
 * server answers and closes before the whole file was sent, as it does for an oversized one.
 */
function sendRaw(
  url: string,
  headers: Record<string, string>,
  chunks: AsyncIterable<Buffer> | Iterable<Buffer>,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', headers });
    let answered = false;
    request.on('response', (response) => {
      answered = true;
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts) });
      });
      response.on('error', reject);
    });
    request.on('error', (error) => {
      if (!answered) {
        reject(error);
      }
    });
    void (async () => {
      for await (const chunk of chunks) {
        if (request.destroyed) {
          return;
        }
        if (!request.write(chunk)) {
          await Promise.race([once(request, 'drain'), once(request, 'close')]);
        }
      }
      request.end();
    })().catch(() => undefined);
  });
}

describe('secure uploads', () => {
  let harness: ApiHarness;
  let clamd: StartedClamd;
  let store: StartedObjectStore;
  let runner: JobRunner;
  let buyerA: IssuedToken;
  let qualityA: IssuedToken;
  let auditorA: IssuedToken;
  let adminA: IssuedToken;
  let buyerB: IssuedToken;
  const cleanups: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    const started = await Promise.allSettled([startClamd(), startObjectStore()]);
    for (const service of started) {
      if (service.status === 'fulfilled') {
        cleanups.push(() => service.value.close());
      }
    }
    const [startedClamd, startedStore] = started;
    if (startedClamd.status === 'rejected' || startedStore.status === 'rejected') {
      throw new Error('The scanner or the object store did not start');
    }
    clamd = startedClamd.value;
    store = startedStore.value;
    harness = await startApiHarness({
      environment: {
        STORAGE_ADAPTER: 's3',
        S3_ENDPOINT: store.endpoint,
        S3_ACCESS_KEY_ID: store.accessKeyId,
        S3_SECRET_ACCESS_KEY: store.secretAccessKey,
        S3_FORCE_PATH_STYLE: 'on',
        STORAGE_QUARANTINE_BUCKET: store.buckets.quarantine,
        STORAGE_EVIDENCE_BUCKET: store.buckets.evidence,
        STORAGE_IMPORTS_BUCKET: store.buckets.imports,
        MALWARE_SCANNER: 'clamd',
        CLAMD_HOST: clamd.host,
        CLAMD_PORT: String(clamd.port),
        CLAMD_TIMEOUT_SECONDS: '60',
        UPLOAD_LINK_QUOTA_FILES: String(linkQuotaFiles),
        // Two pooled connections: an upload that held one while streaming would starve the rest.
        DATABASE_POOL_SIZE: '2',
      },
      process: { registry: productionRegistry, workers: false },
    });
    cleanups.unshift(() => harness.close());
    runner = harness.api.app.get(JobRunner);
    buyerA = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    qualityA = await harness.issue('staff_session', harness.tenantA, { roles: ['quality_engineer'] });
    auditorA = await harness.issue('staff_session', harness.tenantA, { roles: ['auditor'] });
    adminA = await harness.issue('staff_session', harness.tenantA, { roles: ['tenant_admin'] });
    buyerB = await harness.issue('staff_session', harness.tenantB, { roles: ['buyer'] });
  }, 600_000);

  afterAll(async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  });

  function uploadHeaders(
    adapter: HttpEntryAdapter,
    token: string,
    file: { readonly mediaType: string; readonly fileName: string; readonly length?: number },
    options: { readonly attest?: boolean } = {},
  ): Record<string, string> {
    return {
      ...credentialHeaders(adapter, token),
      [staffRequestHeader.name]: staffRequestHeader.value,
      'content-type': file.mediaType,
      [uploadFileNameHeader]: encodeURIComponent(file.fileName),
      ...(options.attest === false ? {} : { [uploadAttestationHeader]: 'noControlledTechnicalData.v1' }),
      ...(file.length === undefined ? {} : { 'content-length': String(file.length) }),
    };
  }

  function upload(
    token: IssuedToken,
    purpose: UploadPurpose,
    content: Buffer,
    file: { readonly mediaType: string; readonly fileName: string },
    options: { readonly adapter?: HttpEntryAdapter; readonly attest?: boolean } = {},
  ): Promise<RawResponse> {
    const adapter = options.adapter ?? 'staff';
    return sendRaw(
      `${harness.api.listeners.urls[adapter]}${uploadPath(purpose)}`,
      uploadHeaders(adapter, token.token, { ...file, length: content.byteLength }, options),
      [content],
    );
  }

  async function uploaded(response: RawResponse): Promise<string> {
    expect(response.status, response.body.toString('utf8')).toBe(201);
    const receipt = uploadReceiptSchema.parse(json(response));
    return Promise.resolve(receipt.uploadId);
  }

  async function row(uploadId: string) {
    const [found] = uploadRows.parse(
      (
        await harness.superuser.query(
          `select tenant_id, purpose, media_type, file_name, size_bytes, content_hash, scan_status, scan_finding,
                  scan_signature, uploader_type, credential_id
             from uploads where id = $1`,
          [uploadId],
        )
      ).rows,
    );
    if (found === undefined) {
      throw new Error(`No upload ${uploadId}`);
    }
    return found;
  }

  async function jobFor(name: string, uploadId: string): Promise<DeliveredJob> {
    const [job, ...others] = jobRows.parse(
      (
        await harness.superuser.query(
          `select id, name, data from pl_jobs.job where name = $1 and data -> 'payload' ->> 'uploadId' = $2`,
          [name, uploadId],
        )
      ).rows,
    );
    if (job === undefined || others.length > 0) {
      throw new Error(`Expected one ${name} job for ${uploadId}`);
    }
    return job;
  }

  async function scan(uploadId: string): Promise<void> {
    await runner.run(await jobFor('uploads.scan', uploadId));
  }

  async function download(uploadId: string, token: IssuedToken, adapter: HttpEntryAdapter = 'staff') {
    const response = await fetch(`${harness.api.listeners.urls[adapter]}${uploadDownloadPath(uploadId)}`, {
      headers: credentialHeaders(adapter, token.token),
    });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  }

  async function auditEvents(tenantId: string, event: string) {
    const result = await harness.superuser.query(
      `select actor_type, payload from audit_entries where tenant_id = $1 and payload ->> 'event' = $2 order by seq`,
      [tenantId, event],
    );
    return auditRows.parse(result.rows);
  }

  function quarantineKey(tenantId: string, purpose: UploadPurpose, uploadId: string): string {
    return `t/${tenantId}/${purpose === 'evidence' ? 'evidence' : 'imports'}/${uploadId}`;
  }

  it('scans a clean PDF, releases it to the evidence bucket and records the hash an independent SHA-256 computes', async () => {
    const pdf = syntheticPdf({ streamText: 'BT /F1 12 Tf (Synthetic ISO 9001 certificate) Tj ET' });
    const response = await upload(qualityA, 'evidence', pdf, {
      mediaType: pdfMediaType,
      fileName: 'Synthetic certificate – ISO 9001.pdf',
    });
    const uploadId = await uploaded(response);
    const receipt = uploadReceiptSchema.parse(json(response));
    expect(receipt).toMatchObject({ purpose: 'evidence', sizeBytes: pdf.byteLength, contentHash: sha256(pdf) });
    expect(await row(uploadId)).toMatchObject({
      tenant_id: harness.tenantA,
      content_hash: sha256(pdf),
      scan_status: 'pending',
      uploader_type: 'person',
      credential_id: qualityA.credentialId,
    });
    const key = quarantineKey(harness.tenantA, 'evidence', uploadId);
    expect(await store.exists(store.buckets.quarantine, key)).toBe(true);
    expect((await download(uploadId, qualityA)).status).toBe(409);

    await scan(uploadId);
    expect(await row(uploadId)).toMatchObject({ scan_status: 'clean', scan_finding: null });
    expect(await store.exists(store.buckets.evidence, key)).toBe(true);
    await runner.run(await jobFor('uploads.releaseQuarantine', uploadId));
    expect(await store.exists(store.buckets.quarantine, key)).toBe(false);

    const status = await harness.query('staff', 'uploads.status', { uploadId }, qualityA.token);
    expect(uploadStatusSchema.parse(status.body)).toMatchObject({ scanStatus: 'clean', finding: null });
    const [received] = await auditEvents(harness.tenantA, 'uploads.received');
    expect(received?.payload).toMatchObject({ data: { uploadId, contentHash: sha256(pdf), fileType: 'pdf' } });
  });

  it('serves a download with attachment, nosniff and sandbox headers and writes an audit entry', async () => {
    const pdf = syntheticPdf({ streamText: 'BT (Synthetic declaration) Tj ET' });
    const uploadId = await uploaded(
      await upload(buyerA, 'evidence', pdf, { mediaType: pdfMediaType, fileName: 'déclaration "S-211".pdf' }),
    );
    await scan(uploadId);
    const before = (await auditEvents(harness.tenantA, 'uploads.downloaded')).length;

    const served = await download(uploadId, auditorA);
    expect(served.status).toBe(200);
    expect(served.body.equals(pdf)).toBe(true);
    expect(sha256(served.body)).toBe((await row(uploadId)).content_hash);
    expect(served.headers.get('content-type')).toBe(pdfMediaType);
    expect(served.headers.get('content-disposition')).toBe(
      `attachment; filename="d_claration _S-211_.pdf"; filename*=UTF-8''${encodeURIComponent('déclaration "S-211".pdf')}`,
    );
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toContain('sandbox');
    expect(served.headers.get('cache-control')).toBe('no-store');
    const downloads = await auditEvents(harness.tenantA, 'uploads.downloaded');
    expect(downloads).toHaveLength(before + 1);
    expect(downloads.at(-1)).toMatchObject({
      actor_type: 'person',
      payload: { data: { uploadId, contentHash: sha256(pdf) } },
    });
  });

  it('keeps the EICAR test file quarantined and flagged, and never serves it', async () => {
    const eicar = Buffer.from(eicarTestFile, 'latin1');
    const uploadId = await uploaded(
      await upload(buyerA, 'import', eicar, { mediaType: csvMediaType, fileName: 'synthetic-parts.csv' }),
    );
    await scan(uploadId);
    const flagged = await row(uploadId);
    expect(flagged).toMatchObject({ scan_status: 'flagged', scan_finding: 'malware' });
    expect(flagged.scan_signature).toMatch(/EICAR/i);
    const key = quarantineKey(harness.tenantA, 'import', uploadId);
    expect(await store.exists(store.buckets.quarantine, key)).toBe(true);
    expect(await store.exists(store.buckets.imports, key)).toBe(false);

    const refused = await download(uploadId, buyerA);
    expect(refused.status).toBe(409);
    expect(errorBody.parse(JSON.parse(refused.body.toString('utf8'))).message).toBe(
      'pl.error.conflict.uploadNotServable',
    );
    await scan(uploadId);
    expect((await row(uploadId)).scan_status).toBe('flagged');
    await expect(
      harness.superuser.query(`update uploads set scan_status = 'clean', scan_finding = null where id = $1`, [
        uploadId,
      ]),
    ).rejects.toThrow(/scan_final/);
  });

  it('refuses a binary renamed to .pdf, audits the refusal and leaves no object behind', async () => {
    const before = await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`);
    const response = await upload(qualityA, 'evidence', Buffer.concat([binaryBytes, Buffer.alloc(4096)]), {
      mediaType: pdfMediaType,
      fileName: 'certificate.pdf',
    });
    expect(response.status).toBe(422);
    expect(messageOf(response)).toBe('pl.error.unprocessable.uploadContentMismatch');
    expect(await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`)).toEqual(before);
    const refusals = await auditEvents(harness.tenantA, 'uploads.refused');
    expect(refusals.at(-1)?.payload).toMatchObject({
      data: { purpose: 'evidence', fileType: 'pdf', reason: 'uploadContentMismatch' },
    });
  });

  it('flags a PDF with embedded JavaScript and never serves it', async () => {
    const uploadId = await uploaded(
      await upload(qualityA, 'evidence', syntheticPdf({ javascript: 'objectStream' }), {
        mediaType: pdfMediaType,
        fileName: 'interactive.pdf',
      }),
    );
    await scan(uploadId);
    expect(await row(uploadId)).toMatchObject({
      scan_status: 'flagged',
      scan_finding: 'pdfActiveContent',
      scan_signature: 'Partledger.Pdf.JavaScript',
    });
    expect((await download(uploadId, qualityA)).status).toBe(409);
  });

  it('flags an archive whose content exceeds the scan limits, instead of passing it as clean', async () => {
    const sheet = sheetXml(syntheticRows);
    const split = sheet.indexOf('<sheetData>');
    const padded = Buffer.concat([
      Buffer.from(sheet.slice(0, split)),
      Buffer.alloc(60 * mebibyte, 0x20),
      Buffer.from(sheet.slice(split)),
    ]);
    const workbook = zipOf(
      workbookParts(syntheticRows).map((part) =>
        part.name === 'xl/worksheets/sheet1.xml' ? { name: part.name, content: padded } : part,
      ),
    );
    expect(workbook.byteLength).toBeLessThan(mebibyte);
    const uploadId = await uploaded(
      await upload(buyerA, 'import', workbook, { mediaType: xlsxMediaType, fileName: 'synthetic-parts.xlsx' }),
    );
    await scan(uploadId);
    const flagged = await row(uploadId);
    expect(flagged).toMatchObject({ scan_status: 'flagged', scan_finding: 'scanLimitExceeded' });
    expect(flagged.scan_signature).toMatch(/^Heuristics\.Limits\.Exceeded/);
  });

  it("keeps uploads within their tenant and lets the app role change only a pending upload's scan decision", async () => {
    const uploadId = await uploaded(
      await upload(qualityA, 'evidence', syntheticPdf(), { mediaType: pdfMediaType, fileName: 'certificate.pdf' }),
    );
    const app = await harness.database.connect('pl_app');
    const inTenant = async <Value>(tenantId: string, work: () => Promise<Value>): Promise<Value> => {
      await app.query('begin');
      try {
        await app.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        return await work();
      } finally {
        await app.query('rollback');
      }
    };
    try {
      expect(await inTenant(harness.tenantB, async () => (await app.query('select id from uploads')).rowCount)).toBe(0);
      await expect(
        inTenant(harness.tenantB, () =>
          app.query(
            `insert into uploads (tenant_id, purpose, media_type, file_name, size_bytes, content_hash, attestation,
                                  uploader_type, credential_id, uploaded_at, scan_status)
             values ($1, 'evidence', 'application/pdf', 'x.pdf', 1, $2, 'noControlledTechnicalData.v1', 'person', $3,
                     now(), 'pending')`,
            [harness.tenantB, sha256(Buffer.from('x')), qualityA.credentialId],
          ),
        ),
      ).rejects.toThrow(/uploads_credential_fkey/);
      await expect(
        inTenant(harness.tenantA, () =>
          app.query(`update uploads set file_name = 'renamed.pdf' where id = $1`, [uploadId]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        inTenant(harness.tenantA, () =>
          app.query(`update uploads set scan_status = 'pending' where id = $1`, [uploadId]),
        ),
      ).rejects.toThrow(/scan_final/);
    } finally {
      await app.end();
    }
  });

  it('refuses a file over its cap mid-stream and leaves no object behind', async () => {
    const before = await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`);
    const uploadsBefore = await harness.count('select 1 from uploads');
    let sent = 0;
    function* oversized() {
      yield syntheticPdf();
      for (let index = 0; index < 64; index += 1) {
        sent += mebibyte;
        yield Buffer.alloc(mebibyte, 0x20);
      }
    }
    const response = await sendRaw(
      `${harness.api.listeners.urls.staff}${uploadPath('evidence')}`,
      uploadHeaders('staff', qualityA.token, { mediaType: pdfMediaType, fileName: 'oversized.pdf' }),
      oversized(),
    );
    expect(response.status).toBe(422);
    expect(messageOf(response)).toBe('pl.error.unprocessable.uploadTooLarge');
    expect(response.headers.connection).toBe('close');
    expect(sent).toBeLessThan(64 * mebibyte);
    expect(await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`)).toEqual(before);
    expect(await harness.count('select 1 from uploads')).toBe(uploadsBefore);

    const declared = await sendRaw(
      `${harness.api.listeners.urls.staff}${uploadPath('evidence')}`,
      uploadHeaders('staff', qualityA.token, {
        mediaType: pdfMediaType,
        fileName: 'oversized.pdf',
        length: 30 * mebibyte,
      }),
      [syntheticPdf()],
    );
    expect(declared.status).toBe(422);
    expect(messageOf(declared)).toBe('pl.error.unprocessable.uploadTooLarge');
  });

  it('refuses a supplier link over its quota, and a CSV or XLSX sent through a supplier link', async () => {
    const link = await harness.issue('supplier_link', harness.tenantA);
    const otherLink = await harness.issue('supplier_link', harness.tenantA);
    const png = syntheticPng();
    for (let index = 0; index < linkQuotaFiles; index += 1) {
      await uploaded(
        await upload(
          link,
          'evidence',
          png,
          { mediaType: pngMediaType, fileName: `scan-${index}.png` },
          { adapter: 'portal' },
        ),
      );
    }
    const over = await upload(
      link,
      'evidence',
      png,
      { mediaType: pngMediaType, fileName: 'one-more.png' },
      { adapter: 'portal' },
    );
    expect(over.status).toBe(422);
    expect(messageOf(over)).toBe('pl.error.unprocessable.uploadQuotaExceeded');
    await uploaded(
      await upload(
        otherLink,
        'evidence',
        png,
        { mediaType: pngMediaType, fileName: 'scan.png' },
        { adapter: 'portal' },
      ),
    );

    const csv = await upload(
      otherLink,
      'evidence',
      Buffer.from('Part number\nSYN-1001\n'),
      { mediaType: csvMediaType, fileName: 'parts.csv' },
      { adapter: 'portal' },
    );
    expect(csv.status).toBe(422);
    expect(messageOf(csv)).toBe('pl.error.unprocessable.uploadTypeNotAllowed');
    const xlsx = await upload(
      otherLink,
      'evidence',
      syntheticWorkbook(),
      { mediaType: xlsxMediaType, fileName: 'parts.xlsx' },
      { adapter: 'portal' },
    );
    expect(xlsx.status).toBe(422);
    const importThroughLink = await upload(
      otherLink,
      'import',
      syntheticWorkbook(),
      { mediaType: xlsxMediaType, fileName: 'parts.xlsx' },
      { adapter: 'portal' },
    );
    expect(importThroughLink.status).toBe(403);
  });

  it('refuses a CSV import containing binary content and a macro-enabled workbook renamed to .xlsx', async () => {
    const csv = await upload(buyerA, 'import', Buffer.concat([Buffer.from('SYN-1001,A\n'), binaryBytes]), {
      mediaType: csvMediaType,
      fileName: 'parts.csv',
    });
    expect(csv.status).toBe(422);
    expect(messageOf(csv)).toBe('pl.error.unprocessable.uploadContentMismatch');
    const macro = await upload(buyerA, 'import', macroEnabledWorkbook(), {
      mediaType: xlsxMediaType,
      fileName: 'parts.xlsx',
    });
    expect(macro.status).toBe(422);
    expect(messageOf(macro)).toBe('pl.error.unprocessable.uploadContentMismatch');
    const accepted = await upload(buyerA, 'import', syntheticWorkbook(), {
      mediaType: xlsxMediaType,
      fileName: 'parts.xlsx',
    });
    expect(accepted.status).toBe(201);
  });

  it('refuses an upload without the controlled technical data attestation', async () => {
    const response = await upload(
      qualityA,
      'evidence',
      syntheticPdf(),
      { mediaType: pdfMediaType, fileName: 'certificate.pdf' },
      { attest: false },
    );
    expect(response.status).toBe(400);
    expect(messageOf(response)).toBe('pl.error.invalid.attestationRequired');
  });

  it('refuses uploads and downloads to roles and tenants without access', async () => {
    const forbidden = await upload(adminA, 'evidence', syntheticPdf(), {
      mediaType: pdfMediaType,
      fileName: 'certificate.pdf',
    });
    expect(forbidden.status).toBe(403);
    const uploadId = await uploaded(
      await upload(qualityA, 'evidence', syntheticPdf(), { mediaType: pdfMediaType, fileName: 'certificate.pdf' }),
    );
    await scan(uploadId);
    expect((await download(uploadId, qualityA)).status).toBe(200);
    expect((await download(uploadId, buyerB)).status).toBe(404);
    expect((await harness.query('staff', 'uploads.status', { uploadId }, buyerB.token)).status).toBe(404);
    expect((await download(uploadId, adminA)).status).toBe(403);
    const link = await harness.issue('supplier_link', harness.tenantA);
    expect((await download(uploadId, link, 'portal')).status).toBe(403);
    expect((await harness.query('portal', 'uploads.status', { uploadId }, link.token)).status).toBe(404);
  });

  it('does not hold a database connection while a slow upload streams', async () => {
    const chunk = Buffer.alloc(16 * 1024, 0x20);
    async function* slowly() {
      yield syntheticPdf();
      for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        yield chunk;
      }
    }
    const slowUploads = Array.from({ length: 3 }, () =>
      sendRaw(
        `${harness.api.listeners.urls.staff}${uploadPath('evidence')}`,
        uploadHeaders('staff', qualityA.token, { mediaType: pdfMediaType, fileName: 'slow.pdf' }),
        slowly(),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const busy = await harness.count(
      `select 1 from pg_stat_activity where usename = 'pl_app' and state in ('active', 'idle in transaction')`,
    );
    const started = Date.now();
    const answered = await harness.query('staff', 'uploads.status', { uploadId: randomUUID() }, qualityA.token);
    expect(answered.status).toBe(404);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(busy).toBe(0);
    for (const response of await Promise.all(slowUploads)) {
      expect(response.status).toBe(201);
    }
  });

  it('a failed recording transaction leaves no quarantine object', async () => {
    await harness.superuser.query(
      `create function public.fail_recording_fixture() returns trigger language plpgsql as $$
       begin
         if new.file_name = 'fail-recording.pdf' then
           raise exception 'synthetic recording failure';
         end if;
         return new;
       end $$`,
    );
    await harness.superuser.query(
      `create trigger uploads_fail_recording_fixture before insert on uploads
         for each row execute function public.fail_recording_fixture()`,
    );
    try {
      const before = await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`);
      const uploadsBefore = await harness.count('select 1 from uploads');
      const response = await upload(qualityA, 'evidence', syntheticPdf(), {
        mediaType: pdfMediaType,
        fileName: 'fail-recording.pdf',
      });
      expect(response.status).toBe(500);
      expect(await store.keys(store.buckets.quarantine, `t/${harness.tenantA}/`)).toEqual(before);
      expect(await harness.count('select 1 from uploads')).toBe(uploadsBefore);
    } finally {
      await harness.superuser.query('drop trigger uploads_fail_recording_fixture on uploads');
      await harness.superuser.query('drop function public.fail_recording_fixture()');
    }
  });

  it('a slow scan holds no database connection', async () => {
    const uploadId = await uploaded(
      await upload(qualityA, 'evidence', syntheticPdf(), { mediaType: pdfMediaType, fileName: 'slow-scan.pdf' }),
    );
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const scanning = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slowScanner: MalwareScanner = {
      async scan() {
        entered();
        await released;
        return { kind: 'clean' };
      },
    };
    const migrator = await harness.database.connect('pl_migrator');
    await migrator.query('grant select on internal_test_notes to pl_backup');
    await migrator.end();
    const other = await harness.startAnotherApi({
      registry: productionRegistry,
      workers: false,
      // The harness created its notes table after the first API booted.
      catalogTables: jobsTestCatalogTables.filter((access) => access.table === 'internal_test_notes'),
      malwareScanner: slowScanner,
    });
    try {
      const run = other.app.get(JobRunner).run(await jobFor('uploads.scan', uploadId));
      await scanning;
      const holding = await harness.count(
        `select 1 from pg_stat_activity where usename = 'pl_app' and state in ('active', 'idle in transaction')`,
      );
      release();
      await run;
      expect(holding).toBe(0);
      expect((await row(uploadId)).scan_status).toBe('clean');
    } finally {
      release();
      await other.close();
    }
  });

  it('leaves a file pending and unserved while clamd is stopped, and completes the scan after a restart', async () => {
    const first = await uploaded(
      await upload(buyerA, 'import', Buffer.from('Part number\nSYN-2001\n'), {
        mediaType: csvMediaType,
        fileName: 'first.csv',
      }),
    );
    const second = await uploaded(
      await upload(buyerA, 'import', Buffer.from('Part number\nSYN-2002\n'), {
        mediaType: csvMediaType,
        fileName: 'second.csv',
      }),
    );
    await clamd.stop();
    try {
      await expect(scan(first)).rejects.toThrow(JobItemFailedError);
      expect((await row(first)).scan_status).toBe('pending');
      expect((await download(first, buyerA)).status).toBe(409);

      // The scan job gives up after its attempts, raises the scanner alert, and leaves the file to the sweep.
      const secondJob = await jobFor('uploads.scan', second);
      await expect(runner.run(secondJob)).rejects.toThrow(JobItemFailedError);
      await expect(runner.run(secondJob)).rejects.toThrow(JobItemFailedError);
      await runner.run(secondJob);
      expect((await row(second)).scan_status).toBe('pending');
      expect(
        await harness.count(`select 1 from operational_alerts where tenant_id = $1 and kind = 'scannerUnavailable'`, [
          harness.tenantA,
        ]),
      ).toBe(1);
    } finally {
      await clamd.restart();
    }

    await scan(first);
    expect((await row(first)).scan_status).toBe('clean');
    expect((await download(first, buyerA)).status).toBe(200);

    harness.clock.advance(6 * 60 * 1000);
    const sweep = await runner.run({
      id: randomUUID(),
      name: 'uploads.rescanPending',
      data: { tenantId: harness.tenantA, cause: 'schedule', source: 'uploads.pendingScanSweep', payload: {} },
    });
    expect(sweep.applied.some((item) => item.startsWith(`rescan:${second}:`))).toBe(true);
    expect((await row(second)).scan_status).toBe('clean');
  });
});
