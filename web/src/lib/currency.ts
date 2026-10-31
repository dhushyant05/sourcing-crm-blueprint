import type { Currency, ExchangeRate } from './types';

export interface Rates { CNY_INR: number; USD_INR: number; USD_CNY?: number }
export const label = (c: string) => (c === 'CNY' ? 'RMB' : c);

export function convert(v: number, from: Currency, to: Currency, r: Rates): number {
  if (from === to) return v;
  if (from === 'USD' && to === 'CNY' && r.USD_CNY) return v * r.USD_CNY;
  if (from === 'CNY' && to === 'USD' && r.USD_CNY) return v / r.USD_CNY;
  const inr = { INR: 1, CNY: r.CNY_INR, USD: r.USD_INR };
  return (v * inr[from]) / inr[to];
}

export function money(v: number, c: Currency, compact = false) {
  return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2,
  }).format(v);
}

/** Latest effective date wins; manual override wins on the same day. Same rule as the app. */
export function ratesFrom(list: ExchangeRate[]): Rates {
  const pick = (p: string) =>
    list.filter((r) => r.pair === p)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || Number(b.manual) - Number(a.manual))[0]?.rate;
  return { CNY_INR: pick('CNY_INR') ?? 11.8, USD_INR: pick('USD_INR') ?? 84, USD_CNY: pick('USD_CNY') };
}
