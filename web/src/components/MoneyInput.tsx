import { useTranslation } from 'react-i18next';
import { CURRENCIES, label, symbol } from '../lib/currency';
import type { Currency } from '../lib/types';

/** Amount + currency picker (USD / RMB / INR). The amount is saved in the chosen currency as-is. */
export function MoneyInput({ value, currency, onValue, onCurrency, label: text, id }: {
  value: string; currency: Currency; onValue: (v: string) => void; onCurrency: (c: Currency) => void; label: string; id: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="label" htmlFor={id}>{text}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">{symbol(currency)}</span>
          <input id={id} className="input pl-7 tabular-nums" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} placeholder="0.00" />
        </div>
        <select aria-label={t('common.currency')} data-testid={`${id}-currency`} className="input w-32" value={currency} onChange={(e) => onCurrency(e.target.value as Currency)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{symbol(c)} {label(c)}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Amount with its own symbol and code, e.g. ¥14.12 RMB. */
export function Money({ v, c }: { v?: number; c?: Currency }) {
  if (v == null || !c) return <span className="text-ink-400">—</span>;
  const n = new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return <span className="tabular-nums">{symbol(c)}{n} <span className="text-[11px] font-normal text-ink-400">{label(c)}</span></span>;
}
