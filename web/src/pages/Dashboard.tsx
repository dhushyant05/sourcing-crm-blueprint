import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { PIPELINE } from '../lib/types';
import { money, totalsByCurrency } from '../lib/currency';
import { useTranslation } from 'react-i18next';
import { Avatar, Chip, dot, PageHeader, Skeleton, Sparkline, pretty } from '../components/ui';
import type { Lead, Quotation, Shipment } from '../lib/types';

export function Dashboard({ openLead }: { openLead: (l: Lead) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const { data } = useLoad(() => Promise.all([api.leads(), api.quotations(), api.shipments()]), [api]);
  const [leads, quotes, ships] = (data ?? [null, null, null]) as [Lead[] | null, Quotation[] | null, Shipment[] | null];

  const open = leads?.filter((l) => !['WON', 'LOST'].includes(l.status)).length ?? 0;
  const won = leads?.filter((l) => l.status === 'WON').length ?? 0;
  const closed = leads?.filter((l) => ['WON', 'LOST'].includes(l.status)).length || 1;
  // Per currency — amounts in different currencies are never added together.
  const pipeline = totalsByCurrency(quotes ?? [], (q) => [q.clientCurrency, q.clientUnitPrice != null ? q.clientUnitPrice * q.quantity : undefined]);
  const transit = ships?.filter((s) => s.stage !== 'DELIVERED').length ?? 0;

  const kpis = [
    { label: t('dashboard.openLeads'), value: String(open), delta: 12.5, series: [4, 6, 5, 8, 7, 9, 11, open], color: '#2a9fd6' },
    perms.clientPricing
      ? { label: t('dashboard.quotedPipeline'), hint: t('dashboard.perCurrency'), value: pipeline.map(([c, v]) => money(v, c, true)).join(' · ') || '—', delta: 8.2, series: [3, 4, 4, 6, 5, 7, 8, 9], color: '#14b8a6' }
      : { label: t('dashboard.quotesSent'), value: String(quotes?.length ?? 0), delta: 8.2, series: [1, 2, 2, 3, 3, 4, 5, 6], color: '#14b8a6' },
    { label: t('dashboard.winRate'), value: `${Math.round((won / closed) * 100)}%`, delta: -3.1, series: [60, 58, 62, 55, 57, 52, 54, 50], color: '#f59e0b' },
    { label: t('dashboard.inTransit'), value: String(transit), delta: 4.0, series: [1, 2, 1, 3, 2, 3, 2, transit], color: '#06b6d4' },
  ];
  const counts = PIPELINE.map((s) => ({ s, n: leads?.filter((l) => l.status === s).length ?? 0 }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  return (
    <>
      <PageHeader title={t('dashboard.greeting')} subtitle={t('dashboard.subtitle')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-5 transition-shadow hover:shadow-lift">
            <div className="text-sm text-ink-500" title={(k as { hint?: string }).hint}>{k.label}</div>
            <div className="mt-2 flex items-end justify-between gap-2">
              {data ? <div className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">{k.value}</div> : <Skeleton className="h-8 w-20" />}
              <Sparkline data={k.series} color={k.color} />
            </div>
            <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${k.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {k.delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(k.delta)}% <span className="font-normal text-ink-400">{t('common.vsLastMonth')}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card p-6 lg:col-span-3">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('dashboard.pipeline')}</h2>
          <p className="text-sm text-ink-500">{t('dashboard.byStage')}</p>
          <div className="mt-6 flex items-end gap-3">
            {counts.map(({ s, n }) => (
              <div key={s} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{data ? n : ''}</span>
                <div className="flex h-36 w-full items-end rounded-lg bg-ink-100/70 dark:bg-ink-800/60">
                  <div className={`w-full rounded-lg ${dot[s]} opacity-80 transition-[height] duration-700`} style={{ height: data ? `${(n / max) * 100}%` : '0%' }} />
                </div>
                <span className="text-[11px] text-ink-500">{pretty(s)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-6 lg:col-span-2">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('dashboard.recentLeads')}</h2>
          <ul className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
            {!leads && Array.from({ length: 5 }).map((_, i) => <li key={i} className="flex gap-3 py-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-8 flex-1" /></li>)}
            {leads?.slice(0, 6).map((l) => (
              <li key={l.id}>
                <button onClick={() => openLead(l)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/60">
                  <Avatar name={perms.customers ? l.clientName ?? l.name : l.productInterest ?? '?'} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink-900 dark:text-white">{perms.customers ? l.clientName : t('common.leadN', { id: l.id })}</div><div className="truncate text-xs text-ink-500">{l.productInterest} · {t('common.pcs', { n: l.quantity?.toLocaleString() })}</div></div>
                  <Chip value={l.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
