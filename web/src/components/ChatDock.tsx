import { ChevronLeft, Hash, Maximize2, MessageSquare, Minus, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../i18n';
import { loadChatDock, openChatDock, saveChatDock, type ChatDockOpen } from '../lib/chat-dock';
import { useApp } from '../lib/store';
import type { ChatInbox, ChatThread, InternalItem } from '../lib/types';
import { LeadChat } from './LeadChat';
import { SupportThread } from './SupportThread';
import { SiteBadge } from './SiteBadge';
import { InternalThread } from './InternalThread';
import { PresenceToggle, usePresence } from './PresenceToggle';

/** Bottom-right floating chat for the staff app. State survives page changes via sessionStorage. */
export function ChatDock({ route, go, openLeadId }: { route: string; go: (r: 'chat') => void; openLeadId: (id: string) => void }) {
  const { api, session, perms } = useApp();
  const { t } = useTranslation();
  const allowed = session?.role !== 'SUPPLIER' && (perms.can('chat.view_own') || perms.can('chat.view_team') || perms.can('chat.view_all'));
  const presence = usePresence(!!allowed);
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
  const [preview, setPreview] = useState<{ leadRef: string; body: string; leadId: string | null; conversationId?: string | null; quoteId?: string | null } | null>(null);
  const [bump, setBump] = useState(false);
  const [channels, setChannels] = useState<InternalItem[]>([]);
  const [dms, setDms] = useState<InternalItem[]>([]);
  const [compose, setCompose] = useState<null | 'dm'>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const onFullChat = route === 'chat';

  useEffect(() => {
    saveChatDock({ open, view, inboxId, leadId, conversationId, quoteId });
  }, [open, view, inboxId, leadId, conversationId, quoteId]);

  const loadInternal = async () => {
    if (!api.internalChat) return;
    try { const d = await api.internalChat(); setChannels(d.channels); setDms(d.dms); } catch { /* keep last */ }
  };
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

  useEffect(() => { if (allowed) { void loadBoxes(); void loadInternal(); if (api.chatDirectory) void api.chatDirectory().then(setPeople).catch(() => {}); } }, [api, allowed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (inboxId) void loadThreads(inboxId); }, [inboxId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (conversationId && threads.length) {
      const th = threads.find((x) => x.id === conversationId || (leadId && x.leadId === leadId));
      if (th) { setActive(th); if (th.leadId) setLeadId(th.leadId); return; }
    }
    if (!leadId || !threads.length) return;
    const th = threads.find((x) => x.leadId === leadId);
    if (th) { setActive(th); setConversationId(th.id); }
  }, [threads, leadId, conversationId]);

  useEffect(() => {
    if (!conversationId || !api.conversation) return;
    if (active?.id === conversationId) return;
    if (threads.some((x) => x.id === conversationId)) return;
    void api.conversation(conversationId).then((c) => {
      setActive({
        id: conversationId, leadId: c.leadId ?? null, leadRef: c.leadRef ?? 'Support', product: c.product ?? null,
        lastBody: null, lastAt: null, unread: 0, assignedTo: c.assignedTo ?? null, assignedToName: c.assignedToName ?? null,
        kind: c.kind, guestName: c.guestName, canConvert: c.canConvert, convertedLeadId: c.convertedLeadId,
      });
      if (c.kind === 'CUSTOMER_SUPPORT' || c.kind === 'SUPPLIER_EMAIL') setLeadId(null);
      else if (c.leadId) setLeadId(c.leadId);
      const box = inboxes.find((i) => i.slug === (c.kind === 'SUPPLIER_EMAIL' ? 'supplier-email' : 'customer-support'));
      if (box && (c.kind === 'CUSTOMER_SUPPORT' || c.kind === 'SUPPLIER_EMAIL')) setInboxId(box.id);
    }).catch(() => {});
  }, [conversationId, threads, api, inboxes, active?.id]);

  useEffect(() => {
    const openDock = (e: Event) => {
      const d = (e as CustomEvent<ChatDockOpen>).detail ?? {};
      setOpen(true);
      if (d.conversationId || d.leadId) {
        if (d.conversationId) setConversationId(d.conversationId);
        setLeadId(d.leadId ?? null);
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
      void loadInternal();
      if (inboxId) void loadThreads(inboxId);
      if (d.sub !== 'message' || d.userId === session?.id) return;
      if (open && !onFullChat) return;
      const leadRef = (d.leadRef as string) || t('chat.thread');
      const body = String(d.preview || d.lastBody || d.detail || t('notif.CHAT_MESSAGE_nobody', { ref: leadRef }));
      const lid = (d.leadId as string | undefined) ?? null;
      const cid = (d.conversationId as string | undefined) ?? null;
      if (!lid && !cid) return;
      setPreview({ leadRef, body: body.slice(0, 140), leadId: lid, conversationId: cid });
      setBump(true);
      setTimeout(() => setBump(false), 900);
      setTimeout(() => setPreview((p) => ((lid && p?.leadId === lid) || (cid && p?.conversationId === cid) ? null : p)), 6000);
    };
    addEventListener('se:data', h);
    return () => removeEventListener('se:data', h);
  }, [inboxId, open, onFullChat, session?.id, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return null;

  const unread = (inboxes.find((i) => i.kind === 'PERSONAL')?.unread ?? 0) + channels.reduce((n, c) => n + (c.unread || 0), 0) + dms.reduce((n, c) => n + (c.unread || 0), 0);
  const shown = hits ?? threads;
  const personal = inboxes.find((i) => i.kind === 'PERSONAL');
  const teams = inboxes.filter((i) => i.kind === 'TEAM');
  const showWindow = open && !onFullChat;

  const openThread = (th: ChatThread) => {
    const id = th.id || th.conversationId || '';
    setActive({ ...th, id });
    setLeadId(th.leadId);
    setConversationId(id);
    setView('thread');
    setHits(null);
    setPreview(null);
  };
  const openInternal = (it: InternalItem) => {
    setActive({
      id: it.id, leadId: null, leadRef: it.title, product: null, lastBody: it.lastBody, lastAt: it.lastAt,
      unread: it.unread, assignedTo: null, assignedToName: null, kind: it.kind, title: it.title, mixed: it.mixed,
      isGroup: it.isGroup, slug: it.slug, members: it.members, conversationId: it.id,
    });
    setLeadId(null);
    setConversationId(it.id);
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
            <button type="button" data-testid="chat-dock-preview" onClick={() => openChatDock({ leadId: preview.leadId ?? undefined, conversationId: preview.conversationId ?? undefined })}
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
                {view === 'thread' ? (active?.title || active?.leadRef || t('chat.thread')) : t('chat.title')}
              </div>
              {view === 'thread' && active?.product && <div className="truncate text-[11px] text-ink-500">{active.product}</div>}
            </div>
            {view === 'thread' && leadId && (
              <button type="button" className="btn-ghost hidden px-2 text-xs sm:inline" onClick={() => openLeadId(leadId)}>{t('chat.openLead')}</button>
            )}
            {view === 'inbox' && <PresenceToggle st={presence.st} set={presence.set} />}
            <button type="button" className="btn-ghost p-2" title={t('chat.expand')} aria-label={t('chat.expand')} onClick={expand}><Maximize2 size={16} /></button>
            <button type="button" className="btn-ghost p-2" title={t('chat.minimize')} aria-label={t('chat.minimize')} onClick={minimize}><Minus size={16} /></button>
            <button type="button" className="btn-ghost p-2" title={t('common.close')} aria-label={t('common.close')} onClick={close}><X size={16} /></button>
          </header>

          {view === 'inbox' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-dock-threads">
                <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t('chat.channels')}</div>
                {channels.map((c) => (
                  <button type="button" key={c.id} data-testid={`dock-channel-${c.slug || c.id}`} onClick={() => openInternal(c)}
                    className="flex w-full items-center gap-2 border-b border-ink-50 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800">
                    <Hash size={14} className="text-ink-400" />
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                  </button>
                ))}
                <div className="flex items-center justify-between px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <span>{t('chat.directMessages')}</span>
                  {api.openDm && <button type="button" className="text-brand-700" data-testid="dock-new-dm" onClick={() => setCompose((v) => v ? null : 'dm')}><Plus size={12} className="inline" /></button>}
                </div>
                {compose === 'dm' && (
                  <div className="space-y-1 border-b border-ink-50 p-2 text-sm">
                    {people.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((xs) => e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id))} />
                        {p.name}
                      </label>
                    ))}
                    <button type="button" className="btn-primary !py-1 text-xs" disabled={!picked.length} onClick={() => { if (!api.openDm) return; void api.openDm(picked).then((d) => { setCompose(null); setPicked([]); openInternal({ id: d.id!, kind: 'DM', title: d.title || d.leadRef || 'DM', slug: null, isMandatory: false, isGroup: !!d.isGroup, archivedAt: null, mixed: !!d.mixed, unread: 0, lastBody: null, lastAt: null, canLeave: !!d.canLeave, isMember: true, members: d.members ?? [] }); void loadInternal(); }); }}>{t('chat.startChat')}</button>
                  </div>
                )}
                {dms.map((c) => (
                  <button type="button" key={c.id} data-testid={`dock-dm-${c.id}`} onClick={() => openInternal(c)}
                    className="flex w-full items-center gap-2 border-b border-ink-50 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800">
                    <MessageSquare size={14} className="text-ink-400" />
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                  </button>
                ))}
                <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t('chat.inboxes')}</div>
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-100 px-2 py-2 dark:border-ink-800" data-testid="chat-dock-inboxes">
                {personal && (
                  <button type="button" data-testid="chat-dock-personal" onClick={() => { setInboxId(personal.id); setHits(null); }}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${inboxId === personal.id ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200'}`}>
                    {t('chat.myInbox')}{personal.unread > 0 ? ` (${personal.unread})` : ''}
                  </button>
                )}
                {teams.map((b) => (
                  <button type="button" key={b.id} data-testid={`chat-dock-inbox-${b.slug}`} onClick={() => { setInboxId(b.id); setHits(null); }}
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
              <div>
                {shown.length === 0 && <div className="px-4 py-4 text-center text-sm text-ink-400">{t('chat.noThreads')}</div>}
                {shown.map((th) => (
                  <button type="button" key={th.id} onClick={() => openThread(th)}
                    className={`block w-full border-b border-ink-50 px-3 py-2.5 text-left dark:border-ink-800 ${conversationId === th.id || (th.leadId && leadId === th.leadId) ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium text-ink-800 dark:text-ink-100">{th.leadRef ?? th.id.slice(0, 8)}</span>
                      {th.kind === 'CUSTOMER_SUPPORT' && <SiteBadge site={th.sourceSite ?? 'sourceeasy'} />}
                      {th.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{th.unread}</span>}
                      <span className="ml-auto text-[10px] text-ink-400">{th.lastAt ? fmtDate(th.lastAt) : ''}</span>
                    </div>
                    <div className="truncate text-sm text-ink-700 dark:text-ink-200">{th.product || ((th as any).kind === 'SUPPLIER_EMAIL' ? t('chat.supplierEmail') : (th as any).kind === 'CUSTOMER_SUPPORT' ? t('chat.supportThread') : t('chat.thread'))}</div>
                    {th.lastBody && <div className="truncate text-xs text-ink-400">{th.lastBody}</div>}
                  </button>
                ))}
              </div>
              </div>
            </div>
          )}

          {view === 'thread' && (active?.kind === 'CHANNEL' || active?.kind === 'DM') && conversationId && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <InternalThread key={conversationId} conversationId={conversationId} compact onOpenLead={openLeadId} onLeft={() => { setView('inbox'); void loadInternal(); }} />
            </div>
          )}
          {view === 'thread' && (active?.kind === 'CUSTOMER_SUPPORT' || active?.kind === 'SUPPLIER_EMAIL') && conversationId && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <SupportThread key={conversationId} conversationId={conversationId} compact onOpenLead={openLeadId} />
            </div>
          )}
          {view === 'thread' && leadId && active?.kind !== 'CUSTOMER_SUPPORT' && active?.kind !== 'CHANNEL' && active?.kind !== 'DM' && (
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
