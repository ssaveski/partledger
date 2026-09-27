import type { ErrorParams, MessageParams, Money } from '@partledger/contracts';

// One locale until the UI ships more than English (R36, Q8); Canadian English writes CAD as `$`
// and every other currency with its code, so a converted total never passes for a local one.
const locale = 'en-CA';

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(money: Money): string {
  let format = moneyFormats.get(money.currency);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency });
    moneyFormats.set(money.currency, format);
  }
  return format.format(Number(money.amount));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

const dateTimeFormat = new Intl.DateTimeFormat(locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
  hourCycle: 'h23',
});

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

/** Deadlines are decided in UTC (R19), so staff screens show instants in UTC and say so. */
export function formatInstantUtc(isoDateTime: string): string {
  return dateTimeFormat.format(new Date(isoDateTime));
}

/** A calendar date such as `2026-12-04`, shown without shifting it into another day. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

const kilobyte = 1000;

function formatUnit(unit: 'byte' | 'kilobyte' | 'megabyte', value: number): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value);
}

/** A file size in decimal units, as file managers show it. */
export function formatBytes(bytes: number): string {
  if (bytes >= kilobyte * kilobyte) {
    return formatUnit('megabyte', bytes / (kilobyte * kilobyte));
  }
  return bytes >= kilobyte ? formatUnit('kilobyte', bytes / kilobyte) : formatUnit('byte', bytes);
}

/** The first characters of a content hash, enough to compare against a document by eye. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Server params may carry flags and calendar dates; messages interpolate text and numbers only,
 * and a date reads as the screen shows dates elsewhere, so every reader hears the same date.
 */
export function messageParams(params: ErrorParams): MessageParams {
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === 'boolean'
        ? String(value)
        : typeof value === 'string' && calendarDatePattern.test(value)
          ? formatDate(value)
          : value,
    ]),
  );
}
