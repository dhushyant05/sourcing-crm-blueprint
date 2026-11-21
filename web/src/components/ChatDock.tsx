import { ChevronLeft, Maximize2, MessageSquare, Minus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../i18n';
import { loadChatDock, openChatDock, saveChatDock, type ChatDockOpen } from '../lib/chat-dock';
import { useApp } from '../lib/store';
import type { ChatInbox, ChatThread } from '../lib/types';
import { LeadChat } from './LeadChat';

/** Bottom-right floating chat for the staff app. State survives page changes via sessionStorage. */
export function ChatDock({ route, go, openLeadId }: { route: string; go: (r: 'chat') => void; openLeadId: (id: string) => void }) {
  const { api, session, perms } = useApp();
  const { t } = useTranslation();
  const allowed = session?.role !== 'SUPPLIER' && (perms.can('chat.view_own') || perms.can('chat.view_team') || perms.can('chat.view_all'));
  const saved = useMemo(() => loadChatDock(), []);
  const [open, setOpen] = useState(saved.open);
  const [view, setView] = useState<'inbox' | 'thread'>(saved.view);
  const [inboxId, setInboxId] = useState<string | null>(saved.inboxId);
  const [leadId, setLeadId] = useState<string | null>(saved.leadId);
  const [conversationId, setConversationId] = useState<string | null>(saved.conversationId);
  const [quoteId, setQuoteId] = useState<string | null>(saved.quoteId);
  const [inboxes, setInboxes] = useState<ChatInbox[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ChatThread[] | null>(null);
  const [preview, setPreview] = useState<{ leadRef: string; body: string; leadId: string; quoteId?: string | null } | null>(null);
  const [bump, setBump] = useState(false);
  const onFullChat = route === 'chat';

  useEffect(() => {
    saveChatDock({ open, view, inboxId, leadId, conversationId, quoteId });
  }, [open, view, inboxId, leadId, conversationId, quoteId]);

  const loadBoxes = async () => {
    if (!api.chatInboxes) return;
    try {
      const list = await api.chatInboxes();
      setInboxes(list);
      setInboxId((cur) => cur && list.some((i) => i.id === cur) ? cur : (list.find((i) => i.kind === 'PERSONAL')?.id ?? list[0]?.id ?? null));
    } catch { /* keep last */ }
  };
  const loadThreads = async (id: string) => {
    if (!api.inboxConversations) return;
    try { setThreads(await api.inboxConversations(id)); } catch { /* keep last */ }
  };

  useEffect(() => { if (allowed) void loadBoxes(); }, [api, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (inboxId) void loadThreads(inboxId); }, [inboxId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!leadId || !threads.length) return;
    const th = threads.find((x) => x.leadId === leadId || x.id === conversationId);
    if (th) { setActive(th); setConversationId(th.id); }
  }, [threads, leadId, conversationId]);

  useEffect(() => {
    const openDock = (e: Event) => {
      const d = (e as CustomEvent<ChatDockOpen>).detail ?? {};
      setOpen(true);
      if (d.leadId) {
        setLeadId(d.leadId);
        setView('thread');
        if (d.quoteId) setQuoteId(d.quoteId);
      } else {
        setView('inbox');
      }
    };
    addEventListener('se:chat-dock', openDock);
    return () => removeEventListener('se:chat-dock', openDock);
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type !== 'chat') return;
      void loadBoxes();
      if (inboxId) void loadThreads(inboxId);
      if (d.sub !== 'message' || d.userId === session?.id) return;
      if (open && !onFullChat) return;
      const leadRef = (d.leadRef as string) || t('chat.thread');
      const body = String(d.preview || d.lastBody || d.detail || t('notif.CHAT_MESSAGE_nobody', { ref: leadRef }));
      const lid = d.leadId as string | undefined;
      if (!lid) return;
      setPreview({ leadRef, body: body.slice(0, 140), leadId: lid });
      setBump(true);
      setTimeout(() => setBump(false), 900);
      setTimeout(() => setPreview((p) => (p?.leadId === lid ? null : p)), 6000);
    };
    addEventListener('se:data', h);
    return () => removeEventListener('se:data', h);
  }, [inboxId, open, onFullChat, session?.id, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return null;

  const unread = inboxes.find((i) => i.kind === 'PERSONAL')?.unread ?? 0;
  const shown = hits ?? threads;
  const personal = inboxes.find((i) => i.kind === 'PERSONAL');
  const teams = inboxes.filter((i) => i.kind === 'TEAM');
  const showWindow = open && !onFullChat;

  const openThread = (th: ChatThread) => {
    setActive(th);
    setLeadId(th.leadId);
    setConversationId(th.id);
    setView('thread');
    setHits(null);
    setPreview(null);
  };

  const close = () => { setOpen(false); setView('inbox'); setPreview(null); };
  const minimize = () => { setOpen(false); };
  const expand = () => { setOpen(false); go('chat'); };

  const search = async () => {
    if (!q.trim() || !api.searchChat) { setHits(null); return; }
    try { setHits(await api.searchChat(q.trim())); } catch { /* ignore */ }
  };

  return (
    <>
      {!showWindow && (
        <div className="pointer-events-none fixed z-[70] flex flex-col items-end gap-2 right-4 md:right-6 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6">
          {preview && (
            <button type="button" data-testid="chat-dock-preview" onClick={() => openChatDock({ leadId: preview.leadId })}
              className="pointer-events-auto w-72 rounded-xl border border-ink-200 bg-white p-3 text-left shadow-lift dark:border-ink-700 dark:bg-ink-900">
              <div className="font-mono text-[11px] font-medium text-ink-700 dark:text-ink-200">{preview.leadRef}</div>
              <div className="mt-0.5 truncate text-sm text-ink-800 dark:text-ink-100">{preview.body}</div>
            </button>
          )}
          <button type="button" data-testid="chat-dock-bubble" aria-label={t('chat.button')}
            onClick={() => { setOpen(true); setPreview(null); }}
            className={`pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lift hover:bg-brand-700 ${bump ? 'scale-110' : 'scale-100'} transition-transform`}>
            <MessageSquare size={22} />
            {unread > 0 && (
              <span data-testid="chat-dock-badge" className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-rose-500 px-1 text-center text-[11px] font-semibold leading-5 text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        </div>
      )}

      {showWindow && (
        <div data-testid="chat-dock-window"
          className="fixed inset-0 z-[70] flex flex-col bg-white dark:bg-ink-900 md:inset-auto md:bottom-6 md:right-6 md:h-[560px] md:w-[380px] md:overflow-hidden md:rounded-2xl md:border md:border-ink-200 md:shadow-lift dark:md:border-ink-700">
          <header className="flex shrink-0 items-center gap-1 border-b border-ink-100 px-2 py-2 dark:border-ink-800">
            {view === 'thread' && (
              <button type="button" className="btn-ghost p-2" aria-label={t('chat.backToInbox')} onClick={() => setView('inbox')}><ChevronLeft size={18} /></button>
            )}
            <div className="min-w-0 flex-1 px-1">
              <div className="truncate text-sm font-semibold text-ink-900 dark:text-white">
                {view === 'thread' ? (active?.leadRef || t('chat.thread')) : t('chat.title')}
              </div>
              {view === 'thread' && active?.product && <div className="truncate text-[11px] text-ink-500">{active.product}</div>}
            </div>
            {view === 'thread' && leadId && (
              <button type="button" className="btn-ghost hidden px-2 text-xs sm:inline" onClick={() => openLeadId(leadId)}>{t('chat.openLead')}</button>
            )}
            <button type="button" className="btn-ghost p-2" title={t('chat.expand')} aria-label={t('chat.expand')} onClick={expand}><Maximize2 size={16} /></button>
            <button type="button" className="btn-ghost p-2" title={t('chat.minimize')} aria-label={t('chat.minimize')} onClick={minimize}><Minus size={16} /></button>
            <button type="button" className="btn-ghost p-2" title={t('common.close')} aria-label={t('common.close')} onClick={close}><X size={16} /></button>
          </header>

          {view === 'inbox' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-100 px-2 py-2 dark:border-ink-800" data-testid="chat-dock-inboxes">
                {personal && (
                  <button type="button" data-testid="chat-dock-personal" onClick={() => { setInboxId(personal.id); setHits(null); }}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${inboxId === personal.id ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200'}`}>
                    {t('chat.myInbox')}{personal.unread > 0 ? ` (${personal.unread})` : ''}
                  </button>
                )}
                {teams.map((b) => (
                  <button type="button" key={b.id} onClick={() => { setInboxId(b.id); setHits(null); }}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${inboxId === b.id ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200'}`}>
                    {b.name}{b.unread > 0 ? ` (${b.unread})` : ''}
                  </button>
                ))}
              </div>
              <form className="flex items-center gap-2 border-b border-ink-100 px-2 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                <Search size={14} className="text-ink-400" />
                <input className="input !border-0 !bg-transparent !py-2 text-sm" value={q} placeholder={t('chat.search')}
                  onChange={(e) => { setQ(e.target.value); if (!e.target.value) setHits(null); }} />
              </form>
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-dock-threads">
                {shown.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-400">{t('chat.noThreads')}</div>}
                {shown.map((th) => (
                  <button type="button" key={th.id} onClick={() => openThread(th)}
                    className={`block w-full border-b border-ink-50 px-3 py-2.5 text-left dark:border-ink-800 ${leadId === th.leadId ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-ink-800 dark:text-ink-100">{th.leadRef ?? th.id.slice(0, 8)}</span>
                      {th.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{th.unread}</span>}
                      <span className="ml-auto text-[10px] text-ink-400">{th.lastAt ? fmtDate(th.lastAt) : ''}</span>
                    </div>
                    <div className="truncate text-sm text-ink-700 dark:text-ink-200">{th.product || t('chat.thread')}</div>
                    {th.lastBody && <div className="truncate text-xs text-ink-400">{th.lastBody}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === 'thread' && leadId && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <LeadChat key={`${leadId}:${quoteId ?? ''}`} leadId={leadId} preferredQuoteId={quoteId} compact
                onOpenQuote={() => openLeadId(leadId)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
