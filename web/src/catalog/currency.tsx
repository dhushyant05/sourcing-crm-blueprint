import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Currency, Price } from './types';

const KEY = 'se.catalog.currency';
const ALL: Currency[] = ['USD', 'CNY', 'INR'];
const Ctx = createContext<{ currency: Currency; setCurrency: (c: Currency) => void }>({ currency: 'INR', setCurrency: () => undefined });

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>(() => {
    const v = localStorage.getItem(KEY);
    return ALL.includes(v as Currency) ? (v as Currency) : 'INR';
  });
  const value = useMemo(() => ({
    currency,
    setCurrency: (c: Currency) => { localStorage.setItem(KEY, c); setCurrency(c); },
  }), [currency]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useCurrency = () => useContext(Ctx);

export function formatMoney(n: number, currency: Currency) {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : currency === 'CNY' ? 'zh-CN' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: currency === 'INR' ? 0 : 2, minimumFractionDigits: currency === 'INR' ? 0 : 2,
  }).format(n);
}
export function priceLabel(price: Price | undefined, currency: Currency) {
  const a = price?.amounts?.[currency];
  if (!a || a.min == null) return 'Get quote';
  const min = formatMoney(a.min, currency);
  if (a.max != null && a.max !== a.min) return `${min} – ${formatMoney(a.max, currency)}`;
  return min;
}
export const currencyName: Record<Currency, string> = { USD: 'USD', CNY: 'RMB', INR: 'INR' };

export function CurrencySwitch({ className = '' }: { className?: string }) {
  const { currency, setCurrency } = useCurrency();
  return (
    <div className={`inline-flex rounded-full border border-ink-200 bg-white p-0.5 text-xs font-medium ${className}`} role="group" aria-label="Currency">
      {ALL.map((c) => (
        <button key={c} type="button" onClick={() => setCurrency(c)}
          className={`rounded-full px-2.5 py-1 transition ${currency === c ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-50'}`}>
          {currencyName[c]}
        </button>
      ))}
    </div>
  );
}
