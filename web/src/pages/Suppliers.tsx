import { Star } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { useTranslation } from 'react-i18next';
import { Avatar, Empty, PageHeader, TableSkeleton } from '../components/ui';

export function Suppliers({ search }: { search: string }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const { data } = useLoad(() => api.suppliers(), [api]);
  const rows = data?.filter((s) => !search || `${s.name} ${s.city ?? ''} ${s.category ?? ''} ${s.wechat ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader title={t('suppliers.title')} subtitle={t('suppliers.subtitle')} />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title={t('suppliers.none')} /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">{t('common.supplier')}</th><th className="th">{t('suppliers.city')}</th><th className="th">{t('suppliers.category')}</th><th className="th">{t('suppliers.contact')}</th><th className="th">{t('suppliers.rating')}</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={s.name} /><span className="font-medium text-ink-900 dark:text-white">{s.name}</span></div></td>
                  <td className="td">{s.city ?? '—'}</td><td className="td">{s.category ?? '—'}</td>
                  <td className="td"><div>{s.contactName ?? s.phone ?? '—'}</div>{s.wechat && <div className="text-xs text-ink-500">{t('suppliers.wechat', { id: s.wechat })}</div>}</td>
                  <td className="td">{s.rating ? <span className="inline-flex items-center gap-1 font-medium"><Star size={14} className="fill-amber-400 text-amber-400" />{s.rating}</span> : <span className="text-ink-500">{s.notes ?? '—'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
