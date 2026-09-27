import { definePermissions } from './matrix';

/**
 * Uploads (U14): staff who work with documents and imports read an upload's scan status, and a
 * supplier link reads the status of its own uploads. Uploading and downloading are raw
 * requests, not commands; their access rules are pinned in apps/api/src/uploads/upload-access.spec.ts.
 */
export default definePermissions({
  'uploads.status': {
    kind: 'query',
    allow: ['buyer', 'quality_engineer', 'auditor', 'supplier_token'],
  },
});
