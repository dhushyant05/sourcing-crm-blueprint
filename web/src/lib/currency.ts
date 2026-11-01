import type { Currency } from './types';

/** Supported currencies. Amounts are always stored and shown in the currency they were entered in — never converted. */
export const CURRENCIES: Currency[] = ['USD', 'CNY', 'INR'];
/** Display code: CNY is shown as RMB (what both offices call it). */
export const label = (c: string) => (c === 'CNY' ? 'RMB' : c);
export const symbol = (c: Currency) => ({ USD: '$', CNY: '¥', INR: '₹' })[c];

/** e.g. "$1,234.50", "¥14.12", "₹2,01,600.00". Pair with the code (label) wherever symbols could be ambiguous. */
export function money(v: number, c: Currency, compact = false) {
  const n = new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', {
    notation: compact ? 'compact' : 'standard', minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 1 : 2,
  }).format(v);
  return `${symbol(c)}${n}`;
}
/** "¥14.12 RMB" — symbol and code, used in details and the PDF. */
export const moneyCode = (v: number, c: Currency) => `${money(v, c)} ${label(c)}`;

/** Sums per currency (never across). Returns e.g. [["INR", 12000], ["USD", 310]]. */
export function totalsByCurrency<T>(rows: T[], get: (r: T) => [Currency | undefined, number | undefined]) {
  const m = new Map<Currency, number>();
  for (const r of rows) { const [c, v] = get(r); if (c && v != null) m.set(c, (m.get(c) ?? 0) + v); }
  return CURRENCIES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
}
