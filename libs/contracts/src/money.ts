import { z } from 'zod';

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .describe('An ISO 4217 currency code, such as CAD.');

/** A decimal written as a string, so no amount passes through binary floating point on the wire. */
export const decimalSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/)
  .describe('A non-negative decimal number written as a string.');

export const moneySchema = z
  .object({
    amount: decimalSchema,
    currency: currencyCodeSchema,
  })
  .strict()
  .describe('An amount in one currency.');

export type Money = z.infer<typeof moneySchema>;
