import { Hash, Paperclip, Send, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '../i18n';
import { looksSensitive } from '../lib/sensitive';
import { useApp } from '../lib/store';
import type { ChatDirectoryPerson, LeadChat, LeadChatMessage, QuoteOption } from '../lib/types';

/** Staff view of a channel or direct message, with @mentions, quote references and a mixed-chat warning. */
export function InternalThread({ conversationId, compact, onOpenLead, onLeft }: {
  conversationId: string; compact?: boolean; onOpenLead?: (id: string) => void; onLeft?: () => void;
}) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [data, setData] = useState<LeadChat | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQ, setMentionQ] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [warn, setWarn] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteQ, setQuoteQ] = useState('');
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [people, setPeople] = useState<ChatDirectoryPerson[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    if (!api.conversation) return;
    try {
      const d = await api.conversation(conversationId);
      setData(d); setErr(null); setTitleEdit(d.title || d.leadRef || '');
      await api.markChatRead?.(conversationId).catch(() => {});
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, [conversationId, api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages?.length]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type === 'chat' && d.conversationId === conversationId) void load();
    };
    addEventListener('se:data', h);
    return () => removeEventListener('se:data', h);
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!draft.trim() || !data?.mixed) { setWarn(false); return; }
    setWarn(looksSensitive(draft));
  }, [draft, data?.mixed]);

  const members = data?.members ?? data?.participants?.map((p) => ({ userId: p.userId, name: p.name, role: '' })) ?? [];
  const mentionChoices = useMemo(() => {
    const q = mentionQ.toLowerCase();
    return members.filter((m) => m.userId !== session?.id && (!q || m.name.toLowerCase().includes(q)));
  }, [members, mentionQ, session?.id]);

  const onDraft = (v: string) => {
    setDraft(v);
    const m = /(^|[\s])@([^\s@]*)$/.exec(v.slice(0, ta.current?.selectionStart ?? v.length));
    if (m) { setMentionOpen(true); setMentionQ(m[2] ?? ''); }
    else setMentionOpen(false);
    if (api.sendTyping && conversationId) void api.sendTyping(conversationId).catch(() => {});
  };
  const insertMention = (name: string, id: string) => {
    const cur = draft;
    const caret = ta.current?.selectionStart ?? cur.length;
    const before = cur.slice(0, caret).replace(/@([^\s@]*)$/, `@${name} `);
    setDraft(before + cur.slice(caret));
    setMentionIds((xs) => xs.includes(id) ? xs : [...xs, id]);
    setMentionOpen(false);
    ta.current?.focus();
  };

  const send = async (force = false) => {
    const text = draft.trim();
    if ((!text && !files.length) || !api.sendConversationMessage) return;
    if (data?.mixed && looksSensitive(text) && !force) { setWarn(true); return; }
    setBusy(true); setErr(null);
    try {
      await api.sendConversationMessage(conversationId, { content: text || undefined, files: files.length ? files : undefined, mentionIds });
      setDraft(''); setFiles([]); setMentionIds([]); setWarn(false);
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const searchQuotes = async (q: string) => {
    setQuoteQ(q);
    if (!api.quoteOptions) return;
    try { setQuotes(await api.quoteOptions(q)); } catch { setQuotes([]); }
  };

  if (err && !data) return <p className="text-sm text-rose-600">{err}</p>;
  if (!data) return <p className="text-sm text-ink-400">{t('common.loading', { defaultValue: 'Loading…' })}</p>;

  const title = data.title || data.leadRef || t('chat.internal');

  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? '' : 'gap-3'}`} data-testid="internal-thread">
      <div className={`shrink-0 space-y-1 ${compact ? 'mb-2' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Hash size={14} className="text-ink-400" />
          {data.canManage && data.kind === 'CHANNEL' ? (
            <input className="input !py-0.5 max-w-xs text-sm font-medium" value={titleEdit} data-testid="channel-rename"
              onChange={(e) => setTitleEdit(e.target.value)}
              onBlur={() => { const v = titleEdit.trim(); if (v && v !== (data.title || data.leadRef) && api.updateChannel) void api.updateChannel(conversationId, { title: v }).then(() => load()); }} />
          ) : (
            <div className="font-medium text-ink-900 dark:text-white" data-testid="internal-title">{title}</div>
          )}
          {data.mixed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">{t('chat.mixedChannel').split('.')[0]}</span>}
          {data.canLeave && (
            <button type="button" className="ml-auto text-xs text-ink-500 hover:text-rose-600" data-testid="leave-conversation"
              onClick={() => { if (confirm(t('chat.leaveConfirm'))) void api.leaveConversation?.(conversationId).then(() => onLeft?.()); }}>{t('chat.leaveChannel')}</button>
          )}
          {data.canManage && data.kind === 'CHANNEL' && !data.slug?.match(/^(all-staff|india-team|china-team)$/) && (
            <button type="button" className="text-xs text-ink-500 hover:text-rose-600" onClick={() => { if (confirm(t('chat.archiveChannel'))) void api.updateChannel?.(conversationId, { archived: true }).then(() => onLeft?.()); }}>{t('chat.archiveChannel')}</button>
          )}
        </div>
        {data.mixed && <p className="text-[11px] text-amber-800 dark:text-amber-200" data-testid="mixed-banner">{t('chat.mixedChannel')}</p>}
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-500">
          <span>{t('chat.members')}:</span>
          {members.map((m) => <span key={m.userId} className="rounded-full bg-ink-100 px-2 py-0.5 dark:bg-ink-800">{m.name}</span>)}
          {data.canManage && (
            <button type="button" className="inline-flex items-center gap-1 text-brand-700" data-testid="add-members" onClick={() => { setAddOpen((v) => !v); if (!people.length) void api.chatDirectory?.().then(setPeople).catch(() => {}); }}><UserPlus size={12} />{t('chat.addPeople')}</button>
          )}
        </div>
        {addOpen && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-ink-100 p-2 text-sm dark:border-ink-800">
            {people.filter((p) => !members.some((m) => m.userId === p.id)).map((p) => (
              <button type="button" key={p.id} className="block w-full rounded px-2 py-1 text-left hover:bg-ink-50 dark:hover:bg-ink-800"
                onClick={() => void api.addChatParticipant?.(conversationId, p.id).then(() => load())}>{p.name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-testid="internal-messages">
        {data.messages.map((m) => <Bubble key={m.id} m={m} conversationId={conversationId} onOpenLead={onOpenLead} />)}
        <div ref={bottom} />
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}

      <form className="relative shrink-0 border-t border-ink-100 pt-2 dark:border-ink-800" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {mentionOpen && mentionChoices.length > 0 && (
          <div className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-56 overflow-y-auto rounded-md border border-ink-100 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900" data-testid="mention-list">
            {mentionChoices.slice(0, 8).map((m) => (
              <button type="button" key={m.userId} className="block w-full px-3 py-1 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800" onClick={() => insertMention(m.name, m.userId)}>@{m.name}</button>
            ))}
          </div>
        )}
        {quoteOpen && (
          <div className="absolute bottom-full left-0 right-0 z-10 mb-1 rounded-md border border-ink-100 bg-white p-2 shadow-lg dark:border-ink-700 dark:bg-ink-900" data-testid="quote-picker">
            <input className="input mb-2 !py-1 text-sm" placeholder={t('chat.searchQuotes')} value={quoteQ} autoFocus
              onChange={(e) => void searchQuotes(e.target.value)} />
            <div className="max-h-48 overflow-y-auto text-sm">
              {quotes.length === 0 && <div className="px-2 py-3 text-ink-400">{t('chat.noQuotes')}</div>}
              {quotes.map((q) => (
                <button type="button" key={q.quoteId} className="block w-full rounded px-2 py-1.5 text-left hover:bg-ink-50 dark:hover:bg-ink-800"
                  onClick={() => { void api.attachConversationQuote?.(conversationId, q.quoteId).then(() => { setQuoteOpen(false); void load(); }); }}>
                  <span className="font-mono text-xs">{q.quoteLabel}</span>
                  <span className="ml-2 text-ink-600">{q.product}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {warn && <p className="mb-1 text-[11px] text-amber-800 dark:text-amber-200" data-testid="sensitive-warn">{t('chat.sensitiveWarn')} <button type="button" className="underline" onClick={() => void send(true)}>{t('chat.send')}</button></p>}
        {files.length > 0 && <div className="mb-1 truncate text-[11px] text-ink-500">{files.map((f) => f.name).join(', ')}</div>}
        <div className="flex items-end gap-1">
          <button type="button" className="rounded-md p-2 text-ink-500 hover:bg-ink-50" aria-label={t('chat.attachFile')} onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
          {api.quoteOptions && (
            <button type="button" className="rounded-md px-1.5 py-2 text-[11px] text-ink-500 hover:bg-ink-50" data-testid="internal-quote" onClick={() => { setQuoteOpen((v) => !v); if (!quotes.length) void searchQuotes(''); }}>{t('chat.attachQuote')}</button>
          )}
          <textarea ref={ta} className="input min-h-[40px] flex-1 resize-none !py-2 text-sm" rows={2} value={draft}
            placeholder={t('chat.placeholder')} data-testid="internal-composer"
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button type="submit" disabled={busy || (!draft.trim() && !files.length)} className="rounded-md bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-50" aria-label={t('chat.send')} data-testid="internal-send"><Send size={16} /></button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m, conversationId }: { m: LeadChatMessage; conversationId: string; onOpenLead?: (id: string) => void }) {
  const { api, session } = useApp();
  const system = m.kind === 'system';
  const mine = m.senderId === session?.id;
  const card = m.quoteReference;
  return (
    <div className={`flex ${system ? 'justify-center' : mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
        system ? 'bg-transparent text-center text-[11px] text-ink-400'
          : mine ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100'
      }`}>
        {!system && <div className="mb-0.5 text-[10px] font-medium opacity-80">{mine ? 'You' : m.senderName}{m.at && <span className="ml-2 font-normal opacity-70">{fmtDate(m.at)}</span>}</div>}
        {card ? (
          <button type="button" className="text-left" onClick={() => { /* lead opens when we have lead id on the card — quote label holds the SE ref */ }}>
            <div className="font-mono text-xs font-semibold">{card.quoteLabel}</div>
            {card.product && <div>{card.product}</div>}
            {card.moq && <div className="opacity-80">MOQ {card.moq}</div>}
          </button>
        ) : m.content?.trim() ? <div className="whitespace-pre-wrap break-words">{linkMentions(m.content)}</div> : null}
        {m.attachments?.map((f) => <FileLink key={f.id} api={api} conversationId={conversationId} messageId={m.id} file={f} light={mine && !system} />)}
      </div>
    </div>
  );
}

function linkMentions(text: string) {
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((p, i) => p.startsWith('@') ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>);
}

function FileLink({ api, conversationId, messageId, file, light }: { api: ReturnType<typeof useApp>['api']; conversationId: string; messageId: string; file: { id: string; name: string; mime: string; url?: string }; light: boolean }) {
  const [url, setUrl] = useState<string | null>(file.url ?? null);
  useEffect(() => {
    if (file.url || !api.chatFileUrl) return;
    let u: string | null = null, live = true;
    api.chatFileUrl(conversationId, messageId, file.id).then((x) => { if (live) { u = x; setUrl(x); } }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [api, conversationId, messageId, file.id, file.url]);
  if (/^image\//.test(file.mime) && url) return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.name} className="mt-1 max-h-40 rounded-md" /></a>;
  return <a href={url ?? '#'} download={file.name} className={`mt-1 block text-xs underline ${light ? 'text-white' : 'text-brand-700'}`}>{file.name}</a>;
}
