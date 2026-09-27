import { z } from 'zod';

import { errorCode } from './errors';

/** Staff roles that may read the tenant's lists; writes are declared per command with their own roles. */
export const staffListReaders = { person: ['buyer', 'quality_engineer', 'approver', 'auditor'] } as const;

/** A list read refuses only a principal without the role; an empty list is an answer, not a failure. */
export const listReadErrors = [errorCode('Forbidden', 'notPermitted')] as const;

/** List reads take no input: the tenant comes from the credential, and screens filter what they show. */
export const listInputSchema = z.object({}).strict().describe('No input: the whole list for the current tenant.');

export const expiryStatuses = ['current', 'expiringSoon', 'expired', 'noExpiry'] as const;

/**
 * How a dated record stands on the server's date, so screens never compare dates themselves:
 * expiringSoon is within 60 days (R14); noExpiry is a record without an end date.
 */
export const expiryStatusSchema = z
  .enum(expiryStatuses)
  .describe('current: valid beyond 60 days; expiringSoon: ends within 60 days; expired: ended; noExpiry: no end date.');

export type ExpiryStatus = z.infer<typeof expiryStatusSchema>;

export const asOfSchema = z.iso
  .date()
  .describe('The server date the read was evaluated on; expiry statuses and date limits count from it.');
