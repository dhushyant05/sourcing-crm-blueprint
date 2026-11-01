import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import type { Currency, Quotation } from '../lib/types';
import { fmtDate } from '../i18n';
import { Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton } from '../components/ui';
import { Money, MoneyInput } from '../components/MoneyInput';

/** Every amount is shown in the currency it was entered in. Supplier cost (China) and client price (India) are independent. */
export function Quotations({ search }: { search: string }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const { data, setData } = useLoad(() => api.quotations(), [api]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = data?.find((q) => q.id === selId) ?? null;
  const rows = data?.filter((q) => !search || `${q.name} ${q.productName} ${q.supplierName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const patch = (id: string, p: Partial<Quotation>) => setData((d) => d && d.map((q) => (q.id === id ? { ...q, ...p } : q)));

  return (
    <>
      <PageHeader title={t('quotes.title')} subtitle={t('quotes.subtitle')} />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title={t('quotes.none')} hint={t('quotes.noneHint')} /> : (
          <div className="md:max-h-[calc(100vh-220px)] md:overflow-auto">
            <table className="rtable w-full text-sm">
              <thead><tr>
                <th className="th">{t('quotes.quote')}</th><th className="th">{t('common.product')}</th>{perms.suppliers && <th className="th">{t('common.supplier')}</th>}
                <th className="th text-right">{t('common.qty')}</th>
                {perms.rawCost && <th className="th text-right">{t('quotes.supplierCost')}</th>}
                {perms.clientPricing && <th className="th text-right">{t('quotes.clientPrice')}</th>}
                {perms.clientPricing && <th className="th text-right">{t('quotes.clientTotal')}</th>}
                {!perms.clientPricing && <th className="th text-right">{t('quotes.supplierTotal')}</th>}
                <th className="th">{t('common.status')}</th>
              </tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} onClick={() => setSelId(q.id)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <td className="td font-medium text-ink-900 dark:text-white">{q.name}</td>
                    <td className="td text-ink-600 dark:text-ink-300">{q.productName}</td>
                    {perms.suppliers && <td className="td text-ink-600 dark:text-ink-300">{q.supplierName}</td>}
                    <td className="td text-right tabular-nums">{q.quantity.toLocaleString()}</td>
                    {perms.rawCost && <td className="td text-right"><Money v={q.unitCost} c={q.currency} /></td>}
                    {perms.clientPricing && <td className="td text-right"><Money v={q.clientUnitPrice} c={q.clientCurrency} /></td>}
                    {perms.clientPricing && <td className="td text-right font-medium text-ink-900 dark:text-white"><Money v={q.clientUnitPrice != null ? q.clientUnitPrice * q.quantity : undefined} c={q.clientCurrency} /></td>}
                    {!perms.clientPricing && <td className="td text-right font-medium text-ink-900 dark:text-white"><Money v={q.totalCost ?? (q.unitCost != null ? q.unitCost * q.quantity : undefined)} c={q.currency} /></td>}
                    <td className="td"><Chip value={q.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SlideOver open={!!sel} onClose={() => setSelId(null)} title={sel?.name} subtitle={sel?.productName}
        footer={<><button className="btn-outline" onClick={() => setSelId(null)}>{t('common.close')}</button>{perms.clientPricing && <button className="btn-primary"><Download size={16} />{t('quotes.pdf')}</button>}</>}>
        {sel && (
          <>
            <dl className="divide-y divide-ink-100 dark:divide-ink-800">
              <Field label={t('common.status')}><Chip value={sel.status} /></Field>
              <Field label={t('common.quantity')}>{t('common.pcs', { n: sel.quantity.toLocaleString() })}</Field>
              {perms.rawCost && <Field label={t('common.supplier')}>{sel.supplierName}</Field>}
              <Field label={t('quotes.validUntil')}>{fmtDate(sel.validityDate, { dateStyle: 'medium' })}</Field>
            </dl>
            {perms.rawCost && (
              <PriceForm key={`c-${sel.id}`} title={t('quotes.setCost')} id="supplier-price" qty={sel.quantity} amount={sel.unitCost} currency={sel.currency ?? 'CNY'}
                onSave={async (v, c) => { const p = { unitCost: v, totalCost: v * sel.quantity, currency: c }; await api.updateQuotePrice(sel.id, p); patch(sel.id, p); }} />
            )}
            {perms.clientPricing && (
              <PriceForm key={`p-${sel.id}`} title={t('quotes.setClient')} id="client-price" qty={sel.quantity} amount={sel.clientUnitPrice} currency={sel.clientCurrency ?? 'INR'}
                onSave={async (v, c) => { const p = { clientUnitPrice: v, clientCurrency: c }; await api.updateQuotePrice(sel.id, p); patch(sel.id, p); }} />
            )}
          </>
        )}
      </SlideOver>
    </>
  );
}

function PriceForm({ title, id, qty, amount, currency, onSave }: {
  title: string; id: string; qty: number; amount?: number; currency: Currency; onSave: (v: number, c: Currency) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(amount != null ? String(amount) : ''), [c, setC] = useState<Currency>(currency);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const n = Number(v);
  const save = async () => {
    if (!(n > 0)) return setMsg(t('quotes.invalid'));
    setBusy(true);
    try { await onSave(n, c); setMsg(t('common.saved')); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="mt-6 rounded-xl border border-ink-200 p-4 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <MoneyInput id={id} label={title} value={v} currency={c} onValue={(x) => { setV(x); setMsg(null); }} onCurrency={(x) => { setC(x); setMsg(null); }} />
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-ink-500">{t('quotes.total')}: <span className="font-medium text-ink-800 dark:text-ink-100"><Money v={n > 0 ? n * qty : undefined} c={c} /></span></span>
        <button disabled={busy} className="btn-primary px-3 py-1.5 disabled:opacity-60">{t('common.save')}</button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-500">{msg}</p>}
    </form>
  );
}
