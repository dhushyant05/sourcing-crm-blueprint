import { MessageSquare, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { ChatAttachment, LeadChat as LeadChatData, LeadChatMessage, QuoteReference } from '../lib/types';
import { fmtDate } from '../i18n';

function cartonLine(q: QuoteReference) {
  const c = q.carton; if (!c) return null;
  const dims = c.lengthCm != null && c.widthCm != null && c.heightCm != null ? `${c.lengthCm} × ${c.widthCm} × ${c.heightCm} cm` : null;
  const cartons = c.cartonCount != null ? `${c.cartonCount} carton${c.cartonCount === 1 ? '' : 's'}` : null;
  const cbm = c.totalCbm != null ? `${c.totalCbm} CBM` : (c.cbmPerCarton != null ? `${c.cbmPerCarton} CBM/carton` : null);
  const line = [dims, c.unitsPerCarton != null ? `${c.unitsPerCarton}/carton` : null, cartons, cbm].filter(Boolean).join(' · ');
  return line || null;
}

function AuthThumb({ load, className }: { load: () => Promise<string>; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    load().then((x) => { if (live) { u = x; setUrl(x); } }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [load]);
  if (!url) return null;
  return <img src={url} alt="" className={className ?? 'h-14 w-14 shrink-0 rounded-md object-cover'} />;
}

export function QuoteCard({ q, onOpen, cover }: { q: QuoteReference; onOpen?: (quoteId: string) => void; cover?: () => Promise<string> }) {
  const pack = cartonLine(q);
  return (
    <button type="button" data-testid="chat-quote-card" onClick={() => onOpen?.(q.quoteId)}
      className="flex w-full gap-2 rounded-lg border border-brand-200 bg-brand-50/80 p-2 text-left text-xs text-ink-800 hover:bg-brand-100/80 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-ink-100 dark:hover:bg-brand-500/20">
      {cover && q.hasCoverPhoto && <AuthThumb load={cover} />}
      <div className="min-w-0">
        <div className="font-mono font-medium text-brand-800 dark:text-brand-200">{q.quoteLabel}</div>
        {q.leadRef && <div className="text-[11px] opacity-80">{q.leadRef}</div>}
        {q.product && <div>{q.product}</div>}
        {q.moq && <div>MOQ {q.moq}</div>}
        {pack && <div>{pack}</div>}
      </div>
    </button>
  );
}

export function LeadChat({ leadId, preferredQuoteId, onOpenQuote, compact }: { leadId: string; preferredQuoteId?: string | null; onOpenQuote?: (quoteId: string) => void; compact?: boolean }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [data, setData] = useState<LeadChatData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [quoteId, setQuoteId] = useState(preferredQuoteId ?? '');
  const [tagQuote, setTagQuote] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const convId = data?.id || data?.conversationId || null;

  const load = async (open = false) => {
    if (!api.leadChat || !api.openLeadChat) { setEnabled(false); return; }
    try {
      const st = api.chatStatus ? await api.chatStatus() : { enabled: true };
      setEnabled(st.enabled);
      if (!st.enabled) return;
      const d = open ? await api.openLeadChat(leadId) : await api.leadChat(leadId);
      setData(d);
      setQuoteId((cur) => cur || preferredQuoteId || d.suggestedQuoteId || d.quotes[0]?.quoteId || '');
      setErr(null);
      const id = d.id || d.conversationId;
      if (id && api.markChatRead) void api.markChatRead(id);
    } catch (e) { setErr((e as Error).message); }
  };

  useEffect(() => { void load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preferredQuoteId) { setQuoteId(preferredQuoteId); setTagQuote(true); } }, [preferredQuoteId]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type !== 'chat' || d?.leadId !== leadId) return;
      if (d.sub === 'typing' && d.userId && d.userId !== session?.id) {
        setTyping((cur) => cur.includes(d.name || d.userName || d.userId) ? cur : [...cur, d.name || d.userName || 'Staff']);
        setTimeout(() => setTyping((cur) => cur.filter((n) => n !== (d.name || d.userName || 'Staff'))), 3000);
        return;
      }
      void load(!!convId);
    };
    addEventListener('se:data', h); return () => removeEventListener('se:data', h);
  }, [leadId, convId, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

  if (enabled === false) return null;

  const ensure = async () => {
    if (convId) return convId;
    const d = await api.openLeadChat!(leadId);
    setData(d);
    return d.id || d.conversationId || '';
  };

  const send = async () => {
    const content = text.trim(); if ((!content && !files.length) || !api.sendLeadChat) return;
    setBusy(true);
    try {
      const id = await ensure();
      let m: LeadChatMessage;
      if ((files.length || content) && api.sendConversationMessage && id) {
        m = await api.sendConversationMessage(id, { content, quoteId: tagQuote ? quoteId || undefined : undefined, files: files.length ? files : undefined });
      } else {
        m = await api.sendLeadChat(leadId, content, tagQuote ? quoteId || undefined : undefined);
      }
      setText(''); setFiles([]);
      setData((d) => d ? { ...d, id: d.id || id, conversationId: d.conversationId ?? id, messages: [...d.messages, m] } : d);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const attach = async () => {
    if (!api.attachQuoteReference) return;
    setBusy(true);
    try {
      const m = await api.attachQuoteReference(leadId, quoteId || undefined);
      const id = data?.id || data?.conversationId || m.id;
      setData((d) => d ? { ...d, id: d.id || id, conversationId: d.conversationId ?? id, messages: [...d.messages, m] } : d);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const onType = (v: string) => {
    setText(v);
    if (convId && api.sendTyping) void api.sendTyping(convId);
  };

  const mine = (m: LeadChatMessage) => m.senderId === session?.id || m.senderName === session?.name;
  const coverFor = (q: QuoteReference) => q.coverFileId ? () => api.quoteFileUrl(q.quoteId, { id: q.coverFileId!, name: 'cover', mime: 'image/jpeg', size: 0, createdAt: '' } as any) : undefined;

  return (
    <section data-testid="lead-chat" className={compact ? '' : 'mt-5 rounded-xl border border-ink-100 p-3 dark:border-ink-800'}>
      {!compact && (
        <>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-900 dark:text-white">
            <MessageSquare size={16} /> {t('chat.title')}
          </div>
          <p className="mb-3 text-xs text-ink-500">{t('chat.blurb')}</p>
        </>
      )}
      {enabled === null && <div className="text-xs text-ink-400">{t('common.loading')}</div>}
      {err && <div className="mb-2 text-xs text-rose-600" data-testid="chat-error">{err}</div>}
      {data && (
        <>
          <div className="mb-3 max-h-72 space-y-2 overflow-y-auto rounded-lg bg-ink-50 p-2 dark:bg-ink-950/40" data-testid="chat-messages">
            {data.messages.length === 0 && <div className="py-6 text-center text-xs text-ink-400">{t('chat.empty')}</div>}
            {data.messages.map((m) => (
              <div key={m.id} className={`flex ${mine(m) ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] space-y-1 rounded-xl px-3 py-2 text-sm ${mine(m) ? 'bg-brand-600 text-white' : 'bg-white text-ink-800 dark:bg-ink-800 dark:text-ink-100'}`}>
                  {!mine(m) && <div className="text-[11px] font-medium opacity-80">{m.senderName}</div>}
                  {m.quoteTag && !m.quoteReference && <div className={`text-[11px] font-mono ${mine(m) ? 'text-white/80' : 'text-brand-700 dark:text-brand-300'}`}>{m.quoteTag.quoteLabel}</div>}
                  {m.quoteReference ? <QuoteCard q={m.quoteReference} onOpen={onOpenQuote} cover={coverFor(m.quoteReference)} /> : m.content.trim() ? <div className="whitespace-pre-wrap">{m.content}</div> : null}
                  {(m.attachments ?? []).map((a: ChatAttachment) => (
                    <AttachmentLink key={a.id} api={api} conversationId={convId!} messageId={m.id} file={a} mine={mine(m)} />
                  ))}
                  <div className={`mt-1 text-[10px] ${mine(m) ? 'text-white/70' : 'text-ink-400'}`}>{fmtDate(m.at)}</div>
                </div>
              </div>
            ))}
            {typing.length > 0 && <div className="text-[11px] italic text-ink-400">{t('chat.typing', { name: typing.join(', ') })}</div>}
            <div ref={bottom} />
          </div>
          {data.quotes.length > 0 && (
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 text-xs">
                <span className="mb-1 block text-ink-500">{t('chat.quotePicker')}</span>
                <select data-testid="chat-quote-picker" className="input !py-1.5 text-sm" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                  {data.quotes.map((q) => (
                    <option key={q.quoteId} value={q.quoteId}>{q.quoteLabel}{q.product ? ` · ${q.product}` : ''}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-ink-600 dark:text-ink-300">
                <input type="checkbox" checked={tagQuote} onChange={(e) => setTagQuote(e.target.checked)} /> {t('chat.tagQuote')}
              </label>
              <button type="button" data-testid="chat-attach-quote" className="btn-outline !py-1.5 text-sm" disabled={busy || !quoteId} onClick={() => void attach()}>
                <Paperclip size={14} /> {t('chat.attachQuote')}
              </button>
            </div>
          )}
          {files.length > 0 && <div className="mb-2 text-xs text-ink-500">{files.map((f) => f.name).join(', ')}</div>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input data-testid="chat-input" className="input flex-1" value={text} placeholder={t('chat.placeholder')}
              onChange={(e) => onType(e.target.value)} />
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
            <button type="button" className="btn-outline" title={t('chat.attachFile')} onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
            <button data-testid="chat-send" className="btn-primary" disabled={busy || (!text.trim() && !files.length)}>{t('chat.send')}</button>
          </form>
        </>
      )}
    </section>
  );
}

function AttachmentLink({ api, conversationId, messageId, file, mine }: { api: ReturnType<typeof useApp>['api']; conversationId: string; messageId: string; file: ChatAttachment; mine: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!api.chatFileUrl || !conversationId) return;
    let u: string | null = null, live = true;
    api.chatFileUrl(conversationId, messageId, file.id).then((x) => { if (live) { u = x; setUrl(x); } }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [api, conversationId, messageId, file.id]);
  const isImg = /^image\//.test(file.mime);
  if (isImg && url) return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.name} className="mt-1 max-h-40 rounded-md" /></a>;
  return <a href={url ?? '#'} download={file.name} className={`mt-1 block text-xs underline ${mine ? 'text-white' : 'text-brand-700'}`}>{file.name}</a>;
}
