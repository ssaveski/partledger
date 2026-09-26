import { z } from 'zod';

export const healthResponseSchema = z
  .object({
    status: z.literal('ok').describe('The API process is up and serving requests.'),
  })
  .strict()
  .describe('Liveness of the API process.');

export type HealthResponse = z.infer<typeof healthResponseSchema>;
