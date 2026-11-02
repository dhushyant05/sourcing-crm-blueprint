import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useApp } from '../lib/store';

/** Delivered + lead completed: the order/shipment is closed and read-only. Super admin reopens (lead, order and shipment together). */
export function ClosedBox({ leadId, paymentPending, testid }: { leadId: string; paymentPending?: boolean; testid: string }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const sa = session?.role === 'SUPER_ADMIN';
  const reopen = async () => { if (!api.reopenLead || !confirm(t('closedOrder.reopenConfirm'))) return; setBusy(true); setMsg(null); try { await api.reopenLead(leadId, 'INDIA'); window.dispatchEvent(new CustomEvent('se:data', { detail: { type: 'order', leadId } })); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  return (<div data-testid={testid} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
    <span>🔒 {t('closedOrder.locked')}</span>
    {sa ? <button data-testid={`${testid}-reopen`} className="btn-outline ml-auto !py-1 text-xs" disabled={busy} onClick={() => void reopen()}>{t('closedOrder.reopen')}</button> : <span className="ml-auto text-emerald-700/70 dark:text-emerald-300/70">{t('lost.onlySa')}</span>}
    {msg && <span className="w-full text-red-600">{msg}</span>}
    {paymentPending && <span className="w-full text-amber-700 dark:text-amber-300">{t('closedOrder.payHint')}</span>}
  </div>);
}

export const ClosedBadge = ({ paymentPending }: { paymentPending?: boolean }) => {
  const { t } = useTranslation();
  return (<><span data-testid="closed-badge" className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">✓ {t('status.COMPLETED')}</span>
    {paymentPending && <span data-testid="pay-pending-badge" className={clsx('rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300')}>{t('closedOrder.payPending')}</span>}</>);
};

/** Active / Closed tabs shared by Orders and Shipping. */
export function ClosedTabs({ closed, setClosed, nOpen, nClosed }: { closed: boolean; setClosed: (v: boolean) => void; nOpen: number; nClosed: number }) {
  const { t } = useTranslation();
  const b = (on: boolean, label: string, id: string) => <button data-testid={id} onClick={() => setClosed(on)} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', closed === on ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800')}>{label}</button>;
  return <div className="mb-3 inline-flex gap-1 rounded-xl border border-ink-100 p-1 dark:border-ink-800">{b(false, `${t('closedOrder.active')} (${nOpen})`, 'tab-active')}{b(true, `${t('closedOrder.closed')} (${nClosed})`, 'tab-closed')}</div>;
}
