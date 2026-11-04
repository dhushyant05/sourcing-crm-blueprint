import { RefTag } from './Leads';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import type { Lead } from '../lib/types';
import { fmtDate } from '../i18n';
import { Chip, Empty, PageHeader, TableSkeleton } from '../components/ui';
import { inr, QuoteStatusChip } from '../components/CustomerQuote';

const money = (n: number | null | undefined, c?: string | null) => (n == null ? '—' : `${({ CNY: '¥', USD: '$', INR: '₹' } as Record<string, string>)[c ?? ''] ?? ''} ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${c ?? ''}`.trim());

/** Every quote across all leads. China never sees customer/INR, India never sees the supplier (server-enforced). Row → opens the lead. */
export function Quotations({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const [status, setStatus] = useState(''), [office, setOffice] = useState(''), [mine, setMine] = useState(false);
  const { data } = useLoad(() => api.allQuotes({ status: status || undefined, office: office || undefined, mine }), [api, status, office, mine]);
  const role = session?.role ?? '', china = role.startsWith('CHINA'), india = role.startsWith('INDIA');
  const rows = data?.filter((q) => !search || `${q.leadRef ?? ''} ${q.label ?? ''} ${q.product} ${q.supplier?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const open = (id: string) => { void api.lead(id).then((l) => l && openLead(l)); };
  return (<>
    <PageHeader title={t('qlist.title')} subtitle={t('qlist.subtitle')} />
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select data-testid="ql-status" aria-label={t('qlist.allStatus')} className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('qlist.allStatus')}</option>{['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(`qs.${s}`)}</option>)}</select>
      <select data-testid="ql-office" aria-label={t('qlist.allOffices')} className="input !w-auto" value={office} onChange={(e) => setOffice(e.target.value)}>
        <option value="">{t('qlist.allOffices')}</option><option value="INDIA">India</option><option value="CHINA">China</option></select>
      <label className="flex items-center gap-1.5 text-sm"><input data-testid="ql-mine" type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t('qlist.mine')}</label>
    </div>
    <div className="card overflow-hidden">
      {!data ? <TableSkeleton /> : !rows?.length ? <Empty title={t('qlist.none')} hint={t('qlist.noneHint')} /> : (
        <div className="md:max-h-[calc(100vh-260px)] md:overflow-auto"><table data-testid="quotes-table" className="rtable w-full text-sm">
          <thead><tr><th className="th">{t('qlist.quote')}</th><th className="th">{t('common.product')}</th>{!india && <th className="th">{t('common.supplier')}</th>}
            <th className="th text-right">{t('qlist.china')}</th>{!china && <th className="th text-right">{t('qlist.india')}</th>}
            <th className="th">MOQ</th><th className="th">{t('lq.leadTime')}</th><th className="th">{t('lq.validity')}</th><th className="th">{t('common.status')}</th><th className="th">{t('qlist.leadStatus')}</th><th className="th">{t('qlist.owner')}</th></tr></thead>
          <tbody>{rows.map((q) => (<tr key={q.id} data-testid="quote-row" onClick={() => open(q.leadId)} className="cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800/50">
            <td className="td" data-label={t('qlist.quote')}>{q.leadRef && <RefTag v={q.leadRef} />}<div className="font-mono text-[11px] text-ink-400">{q.label}</div></td>
            <td className="td font-medium" data-label={t('common.product')}>{q.product}</td>
            {!india && <td className="td" data-label={t('common.supplier')}>{q.supplier?.name ?? '—'}</td>}
            <td className="td text-right" data-label={t('qlist.china')}>{money(q.unitPrice, q.currency)}</td>
            {!china && <td className="td text-right font-medium" data-label={t('qlist.india')}>{q.clientPrice != null ? inr(q.clientPrice) : '—'}</td>}
            <td className="td" data-label="MOQ">{q.moq ?? '—'}</td><td className="td" data-label={t('lq.leadTime')}>{q.leadTime ?? '—'}</td><td className="td" data-label={t('lq.validity')}>{q.validity ?? '—'}</td>
            <td className="td" data-label={t('common.status')}><QuoteStatusChip s={q.status} />{q.sentAt && <div className="text-[10px] text-ink-400">{fmtDate(q.sentAt)}</div>}</td>
            <td className="td" data-label={t('qlist.leadStatus')}>{q.leadStatus ? <Chip value={q.leadStatus} /> : '—'}</td>
            <td className="td text-xs" data-label={t('qlist.owner')}>{q.assignedToName ?? (q.ownerOffice ?? '—')}</td>
          </tr>))}</tbody></table></div>)}
    </div>
  </>);
}
