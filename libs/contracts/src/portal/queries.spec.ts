import { describe, expect, it } from 'vitest';

import { linkSecretFromFragment } from './link';
import {
  evidenceRequestSchema,
  lineAnswerSchema,
  outcomeLineSchema,
  portalSessionSchema,
  timeZoneSchema,
} from './queries';

const secret = 'fixture-open-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

describe('supplier link secrets', () => {
  it('read the secret from the URL fragment', () => {
    expect(linkSecretFromFragment(`#${secret}`)).toBe(secret);
    expect(linkSecretFromFragment(secret)).toBe(secret);
  });

  it('treat a missing, truncated or padded secret as no secret', () => {
    expect(linkSecretFromFragment('')).toBeNull();
    expect(linkSecretFromFragment('#')).toBeNull();
    expect(linkSecretFromFragment(`#${secret.slice(1)}`)).toBeNull();
    expect(linkSecretFromFragment(`#${secret.slice(1)}=`)).toBeNull();
    expect(linkSecretFromFragment(`#${secret}&utm=mail`)).toBeNull();
  });
});

describe('the portal read contracts', () => {
  it('give a supplier outcome no field that could name the winner or a price', () => {
    const line = {
      lineId: '00000000-0000-4000-8000-000000008301',
      lineNumber: 1,
      partNumber: 'PN-55120',
      revision: 'B',
      description: 'Gearbox housing, left',
      quantity: 40,
      unit: 'each',
      result: 'notAwarded',
    };
    expect(outcomeLineSchema.safeParse(line).success).toBe(true);
    expect(outcomeLineSchema.safeParse({ ...line, winner: 'Another supplier' }).success).toBe(false);
    expect(outcomeLineSchema.safeParse({ ...line, winningPrice: '395.00' }).success).toBe(false);
  });

  it('refuse a session that opens no screen or names an unknown time zone', () => {
    const session = {
      scope: 'evidence_request',
      supplierName: 'Birchfield Precision',
      buyerName: 'Harbourline Industries',
      rfq: null,
      views: ['evidence'],
      timeZone: 'America/Toronto',
      expiresAt: '2026-10-31T23:59:59Z',
    };
    expect(portalSessionSchema.safeParse(session).success).toBe(true);
    expect(portalSessionSchema.safeParse({ ...session, views: [] }).success).toBe(false);
    expect(portalSessionSchema.safeParse({ ...session, timeZone: 'Mars/Olympus' }).success).toBe(false);
    expect(timeZoneSchema.safeParse('Europe/Paris').success).toBe(true);
  });

  it('take a quote, a no-quote with a reason, or an alternate with its specification', () => {
    const priced = {
      currency: 'CAD',
      priceBreaks: [{ quantity: 200, unitPrice: '52.40' }],
      leadTimeDays: 35,
      minimumOrderQuantity: 100,
      oneOffCosts: '0',
      validUntil: '2026-12-31',
    };
    expect(lineAnswerSchema.safeParse({ kind: 'quote', ...priced }).success).toBe(true);
    expect(lineAnswerSchema.safeParse({ kind: 'quote', ...priced, priceBreaks: [] }).success).toBe(false);
    expect(lineAnswerSchema.safeParse({ kind: 'alternate', ...priced }).success).toBe(false);
    expect(lineAnswerSchema.safeParse({ kind: 'alternate', specification: 'PN-1-H', ...priced }).success).toBe(true);
    expect(lineAnswerSchema.safeParse({ kind: 'noQuote', reason: 'capacity', note: null }).success).toBe(true);
    expect(lineAnswerSchema.safeParse({ kind: 'noQuote', reason: 'busy', note: null }).success).toBe(false);
  });

  it('keep a rejection reason on rejected evidence only, and an upload on everything but a fresh request', () => {
    const request = {
      requestId: '00000000-0000-4000-8000-000000008402',
      typeLabel: 'pl.portal.evidenceType.qualityCertificate',
      status: 'requested',
      dueBy: '2026-10-10',
      uploadedAt: null,
      rejectionReason: null,
      validUntil: null,
    };
    expect(evidenceRequestSchema.safeParse(request).success).toBe(true);
    expect(evidenceRequestSchema.safeParse({ ...request, rejectionReason: 'Unsigned' }).success).toBe(false);
    expect(evidenceRequestSchema.safeParse({ ...request, status: 'rejected' }).success).toBe(false);
    expect(
      evidenceRequestSchema.safeParse({
        ...request,
        status: 'rejected',
        uploadedAt: '2026-09-21T18:22:00Z',
        rejectionReason: 'Unsigned',
      }).success,
    ).toBe(true);
  });
});
