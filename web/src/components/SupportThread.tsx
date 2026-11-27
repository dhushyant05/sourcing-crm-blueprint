import { Paperclip, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../i18n';
import { useApp } from '../lib/store';
import type { CannedReply, ChatAttachment, LeadChat, LeadChatMessage, StaffLite } from '../lib/types';

/** Staff view of a customer-support conversation, including internal notes and convert-to-lead. */
export function SupportThread({ conversationId, compact, onOpenLead }: { conversationId: string; compact?: boolean; onOpenLead: (id: string) => void }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [data, setData] = useState<LeadChat | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [canned, setCanned] = useState<CannedReply[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!api.conversation) return;
    try {
      const d = await api.conversation(conversationId);
      setData(d);
      setErr(null);
      await api.markChatRead?.(conversationId).catch(() => {});
    } catch (e) { setErr((e as Error).message); }
  };

  useEffect(() => { void load(); }, [conversationId, api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (api.cannedReplies) void api.cannedReplies().then(setCanned).catch(() => {}); }, [api]);
  useEffect(() => { void api.staff('INDIA').then(setStaff).catch(() => setStaff([])); }, [api]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages?.length]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type === 'chat' && d.conversationId === conversationId) void load();
    };
    addEventListener('se:data', h);
    return () => removeEventListener('se:data', h);
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = draft.trim();
    if ((!text && !files.length) || !api.sendConversationMessage) return;
    setBusy(true);
    setErr(null);
    try {
      await api.sendConversationMessage(conversationId, { content: text || undefined, files: files.length ? files : undefined, internal });
      setDraft('');
      setFiles([]);
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const convert = async () => {
    if (!api.convertSupportLead) return;
    setBusy(true);
    try {
      const out = await api.convertSupportLead(conversationId);
      await load();
      if (out.leadId) onOpenLead(out.leadId);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const assignable = useMemo(() => {
    const me = session && !staff.some((s) => s.id === session.id) ? [{ id: session.id, name: session.name } as StaffLite] : [];
    return [...me, ...staff];
  }, [staff, session]);

  if (err && !data) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-ink-400">{t('common.loading', { defaultValue: 'Loading…' })}</p>;

  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? '' : 'gap-3'}`} data-testid="support-thread">
      <div className={`shrink-0 space-y-1 text-xs text-ink-600 ${compact ? 'mb-2' : ''}`}>
        <div><span className="font-medium text-ink-800">{data.guestName || t('chat.guest')}</span>{data.customerId ? ` · ${t('chat.customer')}` : ` · ${t('chat.guest')}`}</div>
        {(data.guestEmail || data.guestPhone) && <div data-testid="support-contact">{[data.guestEmail, data.guestPhone].filter(Boolean).join(' · ')}</div>}
        {data.product && <div>{t('chat.productAbout')}: {data.product}</div>}
        {data.source && <div className="text-ink-400">via {data.source}</div>}
        {data.convertedLeadId && data.convertedLeadRef && (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpenLead(data.convertedLeadId!)}>{t('chat.converted', { ref: data.convertedLeadRef })}</button>
        )}
        {data.canConvert && api.convertSupportLead && (
          <button type="button" data-testid="support-convert-lead" disabled={busy} className="btn-outline !py-1 text-xs" onClick={() => void convert()}>{t('chat.convertLead')}</button>
        )}
      </div>

      {api.assignConversation && (
        <label className="mb-2 flex items-center gap-2 text-xs text-ink-500">
          <span>{t('chat.assignedTo')}</span>
          <select className="input !py-1 text-sm" value={data.assignedTo ?? ''} data-testid="support-assign"
            onChange={(e) => void api.assignConversation!(conversationId, e.target.value || null).then(() => load())}>
            <option value="">{t('chat.unassigned')}</option>
            {assignable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {data.assignedTo && !assignable.some((s) => s.id === data.assignedTo) && <option value={data.assignedTo}>{data.assignedToName ?? data.assignedTo}</option>}
          </select>
        </label>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-testid="support-thread-messages">
        {data.messages.map((m) => <SupportBubble key={m.id} m={m} conversationId={conversationId} />)}
        <div ref={bottom} />
      </div>

      {err && <p className="text-xs text-rose-600">{err}</p>}

      {canned.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {canned.map((c) => (
            <button type="button" key={c.id} className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] dark:border-ink-700"
              onClick={() => { setDraft(c.body); }}>{c.title}</button>
          ))}
        </div>
      )}

      <form className="shrink-0 border-t border-ink-100 pt-2 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="mb-1 flex items-center gap-2 text-[11px] text-ink-500">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="support-internal" />
          {t('chat.internalNote')}
        </label>
        {files.length > 0 && <div className="mb-1 truncate text-[11px] text-ink-500">{files.map((f) => f.name).join(', ')}</div>}
        <div className="flex items-end gap-1">
          <button type="button" className="rounded-md p-2 text-ink-500 hover:bg-ink-50" aria-label={t('chat.attachFile')} onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
          <textarea className="input min-h-[40px] flex-1 resize-none !py-2 text-sm" rows={2} value={draft}
            placeholder={internal ? t('chat.internalPlaceholder', { defaultValue: 'Write an internal note…' }) : t('chat.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button type="submit" disabled={busy || (!draft.trim() && !files.length)} className="rounded-md bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-50" aria-label={t('chat.send')}><Send size={16} /></button>
        </div>
      </form>
    </div>
  );
}

function SupportBubble({ m, conversationId }: { m: LeadChatMessage; conversationId: string }) {
  const { api } = useApp();
  const note = m.visibility === 'staff_only';
  const system = m.kind === 'system';
  const guest = m.authorKind === 'guest' || m.authorKind === 'customer';
  return (
    <div className={`flex ${guest ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
        note ? 'border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
          : system ? 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
          : guest ? 'bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100'
          : 'bg-brand-600 text-white'
      }`}>
        <div className="mb-0.5 text-[10px] font-medium opacity-80">
          {note ? 'Internal' : m.senderName || (guest ? 'Customer' : 'You')}
          {m.at && <span className="ml-2 font-normal opacity-70">{fmtDate(m.at)}</span>}
        </div>
        {m.content?.trim() && <div className="whitespace-pre-wrap break-words">{m.content}</div>}
        {m.attachments?.map((f) => (
          <SupportFile key={f.id} api={api} conversationId={conversationId} messageId={m.id} file={f} light={!guest && !note && !system} />
        ))}
      </div>
    </div>
  );
}

function SupportFile({ api, conversationId, messageId, file, light }: { api: ReturnType<typeof useApp>['api']; conversationId: string; messageId: string; file: ChatAttachment; light: boolean }) {
  const [url, setUrl] = useState<string | null>(file.url ?? null);
  useEffect(() => {
    if (file.url || !api.chatFileUrl) return;
    let u: string | null = null, live = true;
    api.chatFileUrl(conversationId, messageId, file.id).then((x) => { if (live) { u = x; setUrl(x); } }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [api, conversationId, messageId, file.id, file.url]);
  const isImg = /^image\//.test(file.mime);
  if (isImg && url) return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.name} className="mt-1 max-h-40 rounded-md" /></a>;
  return <a href={url ?? '#'} download={file.name} className={`mt-1 block text-xs underline ${light ? 'text-white' : 'text-brand-700'}`}>{file.name}</a>;
}
