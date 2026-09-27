import type { Money } from '@partledger/contracts';

// One locale until the UI ships more than English (R36); Canadian English writes CAD as `$` and
// every other currency with its code, so a USD price never passes for a Canadian one.
const locale = 'en-CA';

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(money: Money): string {
  let format = moneyFormats.get(money.currency);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency, maximumFractionDigits: 6 });
    moneyFormats.set(money.currency, format);
  }
  return format.format(Number(money.amount));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

const instantParts: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** An instant in the supplier's time zone, with the zone's abbreviation, such as `Thu, Oct. 15, 2026, 13:00 EDT`. */
export function formatInstantIn(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { ...instantParts, timeZone, timeZoneName: 'short' }).format(
    new Date(isoDateTime),
  );
}

/** The same instant in UTC without a zone name; the message around it says UTC. */
export function formatInstantUtc(isoDateTime: string): string {
  return new Intl.DateTimeFormat(locale, { ...instantParts, timeZone: 'UTC' }).format(new Date(isoDateTime));
}

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

/** A calendar date such as `2026-12-04`, shown without shifting it into another day. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}
