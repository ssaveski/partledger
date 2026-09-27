import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { domainError, failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import type { EmailMessage, EmailPort, EmailUnavailable } from './email.port';

/** One email as the local adapter stores it. */
export const deliveredEmailSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    text: z.string(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export type DeliveredEmail = z.infer<typeof deliveredEmailSchema>;

const idempotencyKeySchema = z.uuid();

/**
 * The email port's local adapter (KTD36): each email becomes `<idempotency key>.json` in a dev
 * inbox directory, so a message sent twice with the same key is stored once, as a provider
 * would deliver it once. For development and tests only; it never sends anything.
 */
export class LocalEmailAdapter implements EmailPort {
  constructor(
    private readonly directory: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<Result<void, EmailUnavailable>> {
    const key = idempotencyKeySchema.safeParse(message.idempotencyKey);
    if (!key.success) {
      return failure(domainError('Unavailable', 'dependencyUnavailable'));
    }
    const email: DeliveredEmail = { from: this.from, ...message, idempotencyKey: key.data };
    try {
      await mkdir(this.directory, { recursive: true });
      // Written whole, then renamed, so a reader never sees half an email.
      const partial = join(this.directory, `.${key.data}.${randomUUID()}.partial`);
      await writeFile(partial, JSON.stringify(email, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(partial, join(this.directory, `${key.data}.json`));
    } catch {
      return failure(domainError('Unavailable', 'dependencyUnavailable'));
    }
    return success(undefined);
  }
}

/** Every email in a local inbox; a missing inbox is an empty one. */
export async function readLocalInbox(directory: string): Promise<DeliveredEmail[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const emails: DeliveredEmail[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const content: unknown = JSON.parse(await readFile(join(directory, name), 'utf8'));
    emails.push(deliveredEmailSchema.parse(content));
  }
  return emails;
}
