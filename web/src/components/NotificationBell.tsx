import { Bell, CheckCheck, CornerDownLeft, Inbox, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { AppNotification } from '../lib/types';
import { fmtDate } from '../i18n';

/** Text uses only the SE reference + product summary (never customer details), so it is safe for China recipients. */
export function notifText(t: (k: string, o?: any) => string, n: AppNotification) {
  const ref = n.leadRef ?? '—', office = n.office === 'CHINA' ? t('leads.officeChina') : t('leads.officeIndia');
  if (n.kind === 'QUEUE') return n.byName ? t('notif.QUEUE', { ref, office }) : t('notif.newEnquiry', { ref });
  return t(n.byName ? `notif.${n.kind}` : `notif.${n.kind}_nobody`, { by: n.byName, ref });
}

export function NotificationBell({ openLead }: { openLead: (id: string) => void }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [data, setData] = useState<{ data: AppNotification[]; unread: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => { api.notifications().then(setData).catch(() => {}); }, [api]);
  useEffect(() => {
    load(); const i = setInterval(load, 30_000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', h); return () => removeEventListener('mousedown', h);
  }, [open]);
  const click = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) { await api.markNotificationRead(n.id).catch(() => {}); load(); }
    openLead(n.leadId);
  };
  const unread = data?.unread ?? 0;
  const Icon = (n: AppNotification) => (n.kind === 'RETURNED' ? CornerDownLeft : n.kind === 'QUEUE' ? Inbox : UserCheck);
  return (
    <div className="relative" ref={box}>
      <button data-testid="notif-bell" className="btn-ghost relative p-2" aria-label={t('header.notifications')} onClick={() => { setOpen(!open); if (!open) load(); }}>
        <Bell size={18} />
        {unread > 0 && <span data-testid="notif-badge" className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div data-testid="notif-panel" className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[92vw] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lift dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center border-b border-ink-100 px-4 py-3 dark:border-ink-800">
            <span className="text-sm font-semibold text-ink-900 dark:text-white">{t('notif.title')}</span>
            {unread > 0 && <span className="ml-2 text-xs text-ink-500">{t('notif.unread', { n: unread })}</span>}
            {unread > 0 && <button className="ml-auto inline-flex items-center gap-1 text-xs text-brand-600" onClick={async () => { await api.markNotificationRead().catch(() => {}); load(); }}><CheckCheck size={14} />{t('notif.markAll')}</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.data.length && <li className="px-4 py-8 text-center text-sm text-ink-500">{t('notif.none')}</li>}
            {data?.data.map((n) => { const I = Icon(n); return (
              <li key={n.id}>
                <button data-testid="notif-item" onClick={() => void click(n)} className={clsx('flex w-full gap-3 px-4 py-3 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800', !n.read && 'bg-brand-50/50 dark:bg-brand-500/5')}>
                  <span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', n.kind === 'RETURNED' ? 'bg-amber-100 text-amber-700' : n.kind === 'QUEUE' ? 'bg-ink-100 text-ink-600' : 'bg-brand-100 text-brand-700')}><I size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-sm', n.read ? 'text-ink-600 dark:text-ink-300' : 'font-medium text-ink-900 dark:text-white')}>{notifText(t, n)}</span>
                    {n.product && <span className="block truncate text-xs text-ink-500">{n.product}</span>}
                    <span className="block text-[11px] text-ink-400">{fmtDate(n.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                </button>
              </li>
            ); })}
          </ul>
        </div>
      )}
    </div>
  );
}
