import { Inbox, MessageSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LeadChat } from '../components/LeadChat';
import { SupportThread } from '../components/SupportThread';
import { SiteBadge, type SourceSite } from '../components/SiteBadge';
import { Empty, PageHeader } from '../components/ui';
import { fmtDate } from '../i18n';
import { useApp } from '../lib/store';
import type { ChatInbox, ChatThread, CannedReply, Lead } from '../lib/types';

function isSupportThread(th: ChatThread) {
  return th.kind === 'CUSTOMER_SUPPORT' || !th.leadId;
}

/** Personal and team inboxes for India↔China staff chat. */
export function ChatPage({ openLead }: { openLead: (l: Lead) => void }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [inboxes, setInboxes] = useState<ChatInbox[]>([]);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ChatThread[] | null>(null);
  const [canned, setCanned] = useState<CannedReply[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cannedForm, setCannedForm] = useState({ title: '', body: '' });
  const [site, setSite] = useState<'all' | SourceSite>('all');

  const loadBoxes = async () => {
    if (!api.chatInboxes) return;
    try {
      const list = await api.chatInboxes();
      setInboxes(list);
      setInboxId((cur) => cur && list.some((i) => i.id === cur) ? cur : (list.find((i) => i.kind === 'PERSONAL')?.id ?? list[0]?.id ?? null));
    } catch (e) { setErr((e as Error).message); }
  };
  const loadThreads = async (id: string) => {
    if (!api.inboxConversations) return;
    try { setThreads(await api.inboxConversations(id)); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  };

  useEffect(() => { void loadBoxes(); if (api.cannedReplies) void api.cannedReplies().then(setCanned).catch(() => {}); }, [api]);
  useEffect(() => { if (inboxId) void loadThreads(inboxId); }, [inboxId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type !== 'chat') return;
      if (inboxId) void loadThreads(inboxId);
      void loadBoxes();
    };
    addEventListener('se:data', h); return () => removeEventListener('se:data', h);
  }, [inboxId]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    if (!q.trim() || !api.searchChat) { setHits(null); return; }
    try { setHits(await api.searchChat(q.trim())); } catch (e) { setErr((e as Error).message); }
  };

  const personal = inboxes.find((i) => i.kind === 'PERSONAL');
  const supportBox = inboxes.find((i) => i.id === inboxId)?.slug === 'customer-support';
  const shown = (hits ?? threads).filter((th) => !supportBox || site === 'all' || (th.kind === 'CUSTOMER_SUPPORT' && (th.sourceSite ?? 'sourceeasy') === site));
  const teams = inboxes.filter((i) => i.kind === 'TEAM');

  const openThread = (th: ChatThread) => { setActive({ ...th, id: th.id || th.conversationId || th.id }); setHits(null); };

  return (
    <>
      <PageHeader title={t('chat.title')} subtitle={t('chat.inboxBlurb')} />
      {err && <p className="mb-3 text-sm text-rose-600">{err}</p>}
      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[16rem_20rem_1fr]">
        <aside className="card divide-y divide-ink-100 overflow-hidden dark:divide-ink-800" data-testid="chat-inboxes">
          {personal && (
            <button type="button" data-testid="personal-inbox" onClick={() => { setInboxId(personal.id); setActive(null); }}
              className={`flex w-full items-center gap-2 px-3 py-3 text-left text-sm ${inboxId === personal.id ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
              <Inbox size={16} />
              <span className="flex-1 font-medium">{t('chat.myInbox')}</span>
              {personal.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{personal.unread}</span>}
            </button>
          )}
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t('chat.teamInboxes')}</div>
          {teams.map((b) => (
            <button type="button" key={b.id} data-testid={`inbox-${b.slug}`} onClick={() => { setInboxId(b.id); setActive(null); }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${inboxId === b.id ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
              <MessageSquare size={16} />
              <span className="flex-1">{b.name}</span>
              {b.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{b.unread}</span>}
            </button>
          ))}
        </aside>
        <section className="card flex flex-col overflow-hidden">
          <form className="flex gap-2 border-b border-ink-100 p-2 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <Search size={14} className="mt-2.5 text-ink-400" />
            <input className="input !border-0 !bg-transparent" value={q} placeholder={t('chat.search')} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setHits(null); }} />
          </form>
          {supportBox && (
            <div className="flex flex-wrap gap-1 border-b border-ink-100 px-2 py-1.5 dark:border-ink-800" role="group" aria-label={t('chat.siteFilter')} data-testid="chat-site-filter">
              {(['all', 'sourceeasy', 'fortune_engineering'] as const).map((s) => (
                <button type="button" key={s} data-testid={`chat-site-${s}`} aria-pressed={site === s} onClick={() => setSite(s)}
                  className={`rounded-full px-2.5 py-1 text-xs ${site === s ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200'}`}>
                  {s === 'all' ? t('chat.siteAll') : s === 'sourceeasy' ? t('chat.siteSourceEasy') : t('chat.siteFortune')}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto" data-testid="inbox-threads">
            {shown.length === 0 && <Empty title={t('chat.noThreads')} />}
            {shown.map((th) => (
              <button type="button" key={th.id} onClick={() => openThread(th)}
                className={`block w-full border-b border-ink-50 px-3 py-2.5 text-left dark:border-ink-800 ${active?.id === th.id ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs font-medium text-ink-800 dark:text-ink-100">{th.leadRef ?? th.id.slice(0, 8)}</span>
                  {th.kind === 'CUSTOMER_SUPPORT' && <SiteBadge site={th.sourceSite ?? 'sourceeasy'} />}
                  {th.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{th.unread}</span>}
                  <span className="ml-auto text-[10px] text-ink-400">{th.lastAt ? fmtDate(th.lastAt) : ''}</span>
                </div>
                <div className="truncate text-sm text-ink-700 dark:text-ink-200">{th.product || (th.kind === 'SUPPLIER_EMAIL' ? t('chat.supplierEmail') : isSupportThread(th) ? t('chat.supportThread') : t('chat.thread'))}</div>
                {th.lastBody && <div className="truncate text-xs text-ink-400">{th.lastBody}</div>}
              </button>
            ))}
          </div>
        </section>
        <section className="card flex flex-col p-4">
          {!active && <div className="m-auto text-sm text-ink-400">{t('chat.pickThread')}</div>}
          {active && isSupportThread(active) && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-ink-100 pb-3 dark:border-ink-800">
                <div>
                  <div className="font-mono text-sm font-medium text-ink-900 dark:text-white">{active.leadRef || active.guestName || t('chat.supportInbox')}</div>
                  <div className="text-xs text-ink-500">{active.product}</div>
                </div>
              </div>
              <SupportThread key={active.id} conversationId={active.id} onOpenLead={(id) => { void api.lead(id).then((l) => l && openLead(l)); }} />
            </>
          )}
          {active && !isSupportThread(active) && active.leadId && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-ink-100 pb-3 dark:border-ink-800">
                <div>
                  <div className="font-mono text-sm font-medium text-ink-900 dark:text-white">{active.leadRef}</div>
                  <div className="text-xs text-ink-500">{active.product}</div>
                </div>
                <button type="button" className="btn-outline ml-auto !py-1 text-xs" onClick={() => { void api.lead(active.leadId!).then((l) => l && openLead(l)); }}>{t('chat.openLead')}</button>
              </div>
              <AssignBar conversationId={active.id} assignedTo={active.assignedTo} assignedToName={active.assignedToName} />
              {canned.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {canned.map((c) => (
                    <button type="button" key={c.id} className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] dark:border-ink-700"
                      onClick={() => api.sendConversationMessage?.(active.id, { cannedId: c.id }).then(() => { /* LeadChat live-reloads */ })}>{c.title}</button>
                  ))}
                </div>
              )}
              <LeadChat key={active.leadId} leadId={active.leadId} compact
                onOpenQuote={() => { void api.lead(active.leadId!).then((l) => l && openLead(l)); }} />
            </>
          )}
          {session?.role !== 'SUPPLIER' && api.createCanned && (
            <details className="mt-4 text-xs text-ink-500">
              <summary className="cursor-pointer font-medium">{t('chat.canned')}</summary>
              <form className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (!cannedForm.title || !cannedForm.body) return; void api.createCanned!(cannedForm.title, cannedForm.body).then((r) => { setCanned((c) => [...c, r]); setCannedForm({ title: '', body: '' }); }).catch((er) => setErr((er as Error).message)); }}>
                <input className="input !py-1" placeholder={t('chat.cannedTitle')} value={cannedForm.title} onChange={(e) => setCannedForm({ ...cannedForm, title: e.target.value })} />
                <input className="input !py-1" placeholder={t('chat.cannedBody')} value={cannedForm.body} onChange={(e) => setCannedForm({ ...cannedForm, body: e.target.value })} />
                <button className="btn-outline !py-1">{t('common.save')}</button>
              </form>
            </details>
          )}
        </section>
      </div>
    </>
  );
}

function AssignBar({ conversationId, assignedTo, assignedToName }: { conversationId: string; assignedTo: string | null; assignedToName: string | null }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    Promise.all([api.staff('INDIA').catch(() => []), api.staff('CHINA').catch(() => [])])
      .then(([a, b]) => setStaff([...a, ...b].map((s) => ({ id: s.id, name: s.name }))));
  }, [api]);
  const options = useMemo(() => {
    const me = session?.id && !staff.some((s) => s.id === session.id) ? [{ id: session.id, name: session.name }] : [];
    return [...me, ...staff];
  }, [staff, session]);
  if (!api.assignConversation) return null;
  return (
    <label className="mb-3 flex items-center gap-2 text-xs text-ink-500">
      <span>{t('chat.assignedTo')}</span>
      <select className="input !py-1 text-sm" value={assignedTo ?? ''} onChange={(e) => void api.assignConversation!(conversationId, e.target.value || null)}>
        <option value="">{t('chat.unassigned')}</option>
        {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {assignedTo && !options.some((s) => s.id === assignedTo) && <option value={assignedTo}>{assignedToName ?? assignedTo}</option>}
      </select>
    </label>
  );
}
