import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler } from '../client/fixture-adapter';
import { reviewQueueQuery } from '../evidence/queries';
import { fixtureHash, fixtureId } from './ids';
import { fixtureAsOf, fixtureSupplierIds } from './suppliers';

/**
 * A synthetic evidence review queue: invented documents, people and certificates only. The
 * deviation on Arbor Fasteners is the one the ready approval packet shows.
 */

type ReviewQueueOutput = z.input<typeof reviewQueueQuery.output>;

const evidenceTypes = {
  qualityCertificate: { code: 'ca.qualityCertificate', label: 'pl.evidence.type.qualityCertificate' },
  forcedLabourAttestation: { code: 'ca.forcedLabourAttestation', label: 'pl.evidence.type.forcedLabourAttestation' },
  materialCertificate: { code: 'ca.materialCertificate', label: 'pl.evidence.type.materialCertificate' },
  insuranceCertificate: { code: 'ca.insuranceCertificate', label: 'pl.evidence.type.insuranceCertificate' },
  conflictMineralsDeclaration: {
    code: 'ca.conflictMineralsDeclaration',
    label: 'pl.evidence.type.conflictMineralsDeclaration',
  },
} as const;

const supplier = {
  arbor: { supplierId: fixtureSupplierIds.arbor, name: 'Arbor Fasteners' },
  birchfield: { supplierId: fixtureSupplierIds.birchfield, name: 'Birchfield Precision' },
  halden: { supplierId: fixtureSupplierIds.halden, name: 'Halden Electronics' },
  kestrel: { supplierId: fixtureSupplierIds.kestrel, name: 'Kestrel Machining' },
  lindqvist: { supplierId: fixtureSupplierIds.lindqvist, name: 'Lindqvist Sheet Metal' },
} as const;

function reviewable() {
  return { allowedTransitions: ['confirm' as const, 'reject' as const], blockingReasons: [] };
}

export const fixtureEvidenceDocumentIds = {
  expiringMaterialCertificate: fixtureId(8001),
  renewedQualityCertificate: fixtureId(8002),
  undatedAttestation: fixtureId(8003),
  staffUploadedCertificate: fixtureId(8004),
  awaitingScan: fixtureId(8005),
} as const;

const reviewQueue: ReviewQueueOutput = {
  asOf: fixtureAsOf,
  maxDeviationUntil: '2027-03-26',
  documents: [
    {
      documentId: fixtureEvidenceDocumentIds.expiringMaterialCertificate,
      supplier: supplier.halden,
      evidenceType: evidenceTypes.materialCertificate,
      fileName: 'halden-material-certificate-2025.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 482_133,
      contentHash: fixtureHash(8001),
      uploadedAt: '2026-09-18T09:12:00Z',
      uploadedBy: { name: 'Jonas Brandt', actorType: 'supplier_token' },
      issuedOn: '2025-11-10',
      expiresOn: '2026-11-10',
      validUntil: '2026-11-10',
      expiry: 'expiringSoon',
      scope: ['electronics'],
      scan: 'clean',
      ...reviewable(),
    },
    {
      documentId: fixtureEvidenceDocumentIds.renewedQualityCertificate,
      supplier: supplier.kestrel,
      evidenceType: evidenceTypes.qualityCertificate,
      fileName: 'kestrel-quality-certificate-2026.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 1_204_551,
      contentHash: fixtureHash(8002),
      uploadedAt: '2026-09-24T15:40:00Z',
      uploadedBy: { name: 'Priya Nandakumar', actorType: 'supplier_token' },
      issuedOn: '2026-09-20',
      expiresOn: '2029-09-19',
      validUntil: '2029-09-19',
      expiry: 'current',
      scope: ['machinedParts'],
      scan: 'clean',
      ...reviewable(),
    },
    {
      documentId: fixtureEvidenceDocumentIds.undatedAttestation,
      supplier: supplier.arbor,
      evidenceType: evidenceTypes.forcedLabourAttestation,
      fileName: 'arbor-attestation-signed.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 220_914,
      contentHash: fixtureHash(8003),
      uploadedAt: '2026-09-25T11:05:00Z',
      uploadedBy: { name: 'Owen Tremblay', actorType: 'supplier_token' },
      issuedOn: '2026-09-15',
      expiresOn: null,
      validUntil: '2027-09-15',
      expiry: 'current',
      scope: ['fasteners', 'seals'],
      scan: 'clean',
      ...reviewable(),
    },
    {
      documentId: fixtureEvidenceDocumentIds.staffUploadedCertificate,
      supplier: supplier.birchfield,
      evidenceType: evidenceTypes.qualityCertificate,
      fileName: 'birchfield-quality-certificate-renewal.png',
      mediaType: 'image/png',
      sizeBytes: 734_002,
      contentHash: fixtureHash(8004),
      uploadedAt: '2026-09-26T08:30:00Z',
      uploadedBy: { name: 'Dana Whitfield', actorType: 'person' },
      issuedOn: '2026-09-01',
      expiresOn: '2029-08-31',
      validUntil: '2029-08-31',
      expiry: 'current',
      scope: ['machinedParts', 'fasteners', 'seals'],
      scan: 'clean',
      ...reviewable(),
    },
    {
      documentId: fixtureEvidenceDocumentIds.awaitingScan,
      supplier: supplier.lindqvist,
      evidenceType: evidenceTypes.insuranceCertificate,
      fileName: 'lindqvist-liability-insurance-2027.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 391_220,
      contentHash: fixtureHash(8005),
      uploadedAt: '2026-09-27T07:55:00Z',
      uploadedBy: { name: 'Elin Sjöberg', actorType: 'supplier_token' },
      issuedOn: '2026-09-01',
      expiresOn: '2027-08-31',
      validUntil: '2027-08-31',
      expiry: 'current',
      scope: ['sheetMetal', 'fasteners'],
      scan: 'pending',
      allowedTransitions: [],
      blockingReasons: [
        { transition: 'confirm', message: 'pl.evidence.blocked.scanPending', params: {} },
        { transition: 'reject', message: 'pl.evidence.blocked.scanPending', params: {} },
      ],
    },
  ],
  gaps: [
    {
      supplier: supplier.arbor,
      evidenceType: evidenceTypes.forcedLabourAttestation,
      problem: 'missing',
      since: null,
      deviation: {
        deviationId: fixtureId(7001),
        reason: 'The supplier has signed its attestation for next year; the countersigned copy is due in October.',
        recordedBy: 'Rafael Okonkwo',
        recordedAt: '2026-09-20T10:00:00Z',
        expiresOn: '2026-11-30',
      },
      allowedTransitions: [],
      blockingReasons: [
        {
          transition: 'recordDeviation',
          message: 'pl.evidence.blocked.alreadyCovered',
          params: { until: '2026-11-30' },
        },
      ],
    },
    {
      supplier: supplier.halden,
      evidenceType: evidenceTypes.conflictMineralsDeclaration,
      problem: 'missing',
      since: null,
      deviation: null,
      allowedTransitions: ['recordDeviation'],
      blockingReasons: [],
    },
    {
      supplier: supplier.kestrel,
      evidenceType: evidenceTypes.qualityCertificate,
      problem: 'expired',
      since: '2026-09-24',
      deviation: null,
      allowedTransitions: ['recordDeviation'],
      blockingReasons: [],
    },
  ],
};

export const evidenceFixtureHandlers: readonly FixtureHandler[] = [
  fixtureQuery(reviewQueueQuery, (_input, view) => ({
    kind: 'output',
    output: view === 'empty' ? { ...reviewQueue, documents: [], gaps: [] } : reviewQueue,
  })),
];

export const evidenceFixtureOutputs = { reviewQueue };
