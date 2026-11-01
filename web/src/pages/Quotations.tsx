import { clsx } from 'clsx';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLoad } from '../lib/store';
import { convert, label, money, ratesFrom } from '../lib/currency';
import type { Currency, Quotation } from '../lib/types';
import { Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton } from '../components/ui';

export function Quotations({ search }: { search: string }) {
  const { api, perms } = useApp();
  const { data } = useLoad(() => Promise.all([api.quotations(), api.rates()]), [api]);
  const [cur, setCur] = useState<Currency>(perms.currencies[0]);
  const [sel, setSel] = useState<Quotation | null>(null);
  const rates = data ? ratesFrom(data[1]) : null;
  const ccy = perms.currencies.includes(cur as never) ? cur : perms.currencies[0];
  const rows = data?.[0].filter((q) => !search || `${q.name} ${q.productName} ${q.supplierName}`.toLowerCase().includes(search.toLowerCase()));

  const unit = (q: Quotation): number =>
    ccy === 'INR' ? q.clientUnitPriceInr ?? q.unitCostInr ?? (q.unitCost ?? 0) * (q.exchangeRateUsed ?? rates!.CNY_INR) : convert(q.unitCost ?? 0, q.currency, ccy, rates!);

  return (
    <>
      <PageHeader title="Quotations" subtitle={ccy === 'INR' ? 'Client prices in INR' : 'Supplier cost as quoted, converted at today’s rate'}
        actions={
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900">
            {perms.currencies.map((c) => (
              <button key={c} onClick={() => setCur(c)} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium transition', ccy === c ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-500 hover:text-ink-800')}>{label(c)}</button>
            ))}
          </div>
        } />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title="No quotations yet" hint="Quotes appear here once China posts supplier prices." /> : (
          <div className="max-h-[calc(100vh-220px)] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Quote</th><th className="th">Product</th>{perms.suppliers && <th className="th">Supplier</th>}<th className="th text-right">Qty</th><th className="th text-right">Unit ({label(ccy)})</th><th className="th text-right">Total</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} onClick={() => setSel(q)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <td className="td font-medium text-ink-900 dark:text-white">{q.name}</td>
                    <td className="td text-ink-600 dark:text-ink-300">{q.productName}</td>
                    {perms.suppliers && <td className="td text-ink-600 dark:text-ink-300">{q.supplierName}</td>}
                    <td className="td text-right tabular-nums">{q.quantity.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{money(unit(q), ccy)}</td>
                    <td className="td text-right font-medium tabular-nums text-ink-900 dark:text-white">{money(unit(q) * q.quantity, ccy)}</td>
                    <td className="td"><Chip value={q.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SlideOver open={!!sel} onClose={() => setSel(null)} title={sel?.name} subtitle={sel?.productName}
        footer={<><button className="btn-outline" onClick={() => setSel(null)}>Close</button>{perms.clientPricing && <button className="btn-primary"><Download size={16} />Quote PDF</button>}</>}>
        {sel && rates && (
          <dl className="divide-y divide-ink-100 dark:divide-ink-800">
            <Field label="Status"><Chip value={sel.status} /></Field>
            <Field label="Quantity">{sel.quantity.toLocaleString()} pcs</Field>
            {perms.rawCost && <><Field label="Supplier">{sel.supplierName}</Field><Field label="Supplier cost">{money(sel.unitCost ?? 0, sel.currency)} / pc</Field><Field label="Rate snapshot">{sel.exchangeRateUsed} INR/{label(sel.currency)}</Field></>}
            {perms.clientPricing && <Field label="Client price">{sel.clientUnitPriceInr ? `${money(sel.clientUnitPriceInr, 'INR')} / pc` : 'Not set'}</Field>}
            <Field label={`Total (${label(ccy)})`}>{money(unit(sel) * sel.quantity, ccy)}</Field>
            <Field label="Valid until">{sel.validityDate && new Date(sel.validityDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</Field>
          </dl>
        )}
      </SlideOver>
    </>
  );
}
