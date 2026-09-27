# Uploads and malware scanning

Every file enters Partledger through one pipeline (plan KTD22, U14): supplier evidence, staff documents and import spreadsheets. The code lives in `apps/api/src/uploads/` and `apps/api/src/storage/`.

## How a file travels

1. `POST /api/v1/uploads/<purpose>` with the file as the raw body. `purpose` is `evidence` (PDF, PNG, JPEG) or `import` (XLSX, CSV). The `Content-Type` is the declared media type, `x-partledger-file-name` the percent-encoded file name, and `x-partledger-attestation: noControlledTechnicalData.v1` the uploader's statement that the file holds no controlled technical data (Q6). Staff upload on the staff listener with the staff app's request header; supplier contacts upload evidence on the portal listener with their link.
2. One short transaction authenticates the request, reads the person's roles and the quotas used so far. It commits before the body is read, so a slow upload holds no database connection.
3. The body streams into the quarantine bucket through the inspector, which hashes it with SHA-256 and refuses it the moment it passes its size cap or its content disagrees with the declared type and file name. A refused upload leaves no object, closes the connection, and is audited as `uploads.refused` with its reason.
4. A second short transaction re-checks the quotas under the tenant's upload lock, records the `uploads` row as `pending`, appends `uploads.received` to the audit chain and enqueues `uploads.scan`.
5. `uploads.scan` hashes the stored object again, streams it to clamd, and inspects PDFs for active content, all outside any database transaction; it then locks the upload, re-checks that it is still pending and that the scanned bytes are the uploaded ones, and records the decision. A clean file is copied to the `evidence` or `imports` bucket and marked `clean`; `uploads.releaseQuarantine` then removes its quarantine copy. Anything else is marked `flagged` with its finding and stays in quarantine for good: a trigger keeps a decided scan from ever changing.
6. `GET /api/v1/uploads/<id>/download` serves only `clean` files, from their destination bucket, with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. Each download appends `uploads.downloaded`.

Object keys are `t/<tenant>/evidence/<upload id>` and `t/<tenant>/imports/<upload id>` in every bucket; file names never reach storage.

## Content rules

| Type | Largest file | Content check |
|---|---|---|
| PDF | 20 MiB | starts with `%PDF-`; flagged when it holds JavaScript, additional actions, launch, remote or embedded go-to, submit or import actions, embedded files, rich media, renditions, movies, sounds or XFA, or opens a web address when it opens (a link the reader clicks is fine), or when its object streams cannot be read exactly (encryption, predictors, filters other than Flate) |
| PNG, JPEG | 10 MiB | PNG signature; JPEG `FF D8 FF` |
| XLSX | 10 MiB | a ZIP whose directory names a workbook; no VBA project, macro sheets, ActiveX controls, embedded objects or external links; no encryption, ZIP64 or unsafe entry names |
| CSV | 10 MiB | UTF-8 text with no NUL or other binary control character |

The declared type must also match the file name's extension. A supplier link uploads evidence only.

## Findings

| Finding | Meaning |
|---|---|
| `malware` | clamd reported a signature; the signature name is in `scan_signature`. |
| `scanLimitExceeded` | The content goes beyond clamd's limits (`Heuristics.Limits.Exceeded.*`, `AlertExceedsMax yes`). The scanner fails closed, so such a file is never served. |
| `pdfActiveContent` | The PDF has active content, or object streams that could not be inspected. |
| `contentChanged` | The stored object is missing or no longer matches the hash recorded at upload. |

A flagged file is never released. If a supplier needs to send the document, they upload a clean copy.

## When clamd is down

A scan that cannot reach clamd leaves the file `pending`, and pending files are never served. `uploads.scan` retries three times over about a minute, then raises one `scannerUnavailable` operational alert per tenant and day and leaves the file to `uploads.rescanPending`, which runs every ten minutes for every enrolled tenant and scans every upload pending for more than five minutes. When clamd is back, the next sweep clears the backlog; nothing needs to be re-uploaded.

```sql
-- Uploads waiting for their scan, oldest first.
select tenant_id, id, purpose, media_type, size_bytes, uploaded_at from uploads where scan_status = 'pending' order by uploaded_at;

-- Flagged uploads and why.
select tenant_id, id, scan_finding, scan_signature, scanned_at from uploads where scan_status = 'flagged' order by scanned_at desc;
```

## Quotas

A supplier link may upload `UPLOAD_LINK_QUOTA_FILES` files and `UPLOAD_LINK_QUOTA_BYTES` bytes over its lifetime; a tenant may upload `UPLOAD_TENANT_DAILY_QUOTA_FILES` files and `UPLOAD_TENANT_DAILY_QUOTA_BYTES` bytes in any 24 hours. Refused uploads do not count.

## Parsing import files

`parseSpreadsheet` in `apps/api/src/uploads/parse-worker.ts` parses a clean import file for U12 in a child process started with a 256 MB V8 heap, no environment, and a 30-second time limit. Before SheetJS sees a workbook, every entry is decompressed under caps (50 MiB per entry, 100 MiB in all, at most 200 times its compressed size for entries over 1 MiB), any part that declares a DTD or an entity, whatever its name, is refused, as is a markup part that is not UTF-8, and every local header must repeat its directory entry's name, method and sizes. It is a child process rather than a worker thread because Node 24 does not hold a worker thread to its `resourceLimits`.

## clamd

`infra/compose/clamd/clamd.conf` is the configuration the region runs and the integration tests start (`apps/api/test/support/upload-services.ts`); `infra/compose/clamd/compose.yaml` runs the pinned `clamav/clamav:1.4` image on an internal network the API joins. `MaxScanTime` (45 s) stays at least 10 s under the API's `CLAMD_TIMEOUT_SECONDS` (60 s by default), so a scan that runs long is flagged by clamd rather than abandoned by the API; a unit test keeps the two apart. Keep the scan limits small: clamd's PDF parser bug CVE-2025-20260 is reachable only with limits above 1 GB. The image needs about 1 GB of memory once its signatures load, and takes about 20 seconds to start.

## Local development

Unset `STORAGE_ADAPTER` and `MALWARE_SCANNER` (or set them to `local`): objects are kept as files under `STORAGE_LOCAL_DIRECTORY`, and the local scanner flags only the EICAR test file. Production refuses both local adapters and requires `STORAGE_ADAPTER=s3` with the region's endpoint and credentials, and `MALWARE_SCANNER=clamd` with `CLAMD_HOST`.
