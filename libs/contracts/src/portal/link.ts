import { z } from 'zod';

/**
 * A supplier link reads `https://<portal>/link/<id>#<secret>` (KTD21). The secret travels only in
 * the URL fragment, which browsers never send, so opening the link reaches no server with it; the
 * portal exchanges it after the person presses Continue.
 */

export const linkIdSchema = z.uuid().describe('The public id of a supplier link.');

/** 256 bits in unpadded base64url. */
export const linkSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .describe('The secret of a supplier link, 256 bits in unpadded base64url.');

/** The secret in a location fragment such as `#abc…`, or null when there is none or it is malformed. */
export function linkSecretFromFragment(fragment: string): string | null {
  const parsed = linkSecretSchema.safeParse(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  return parsed.success ? parsed.data : null;
}
