import { MessageCircle, Minus, Paperclip, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { portalToken } from '../portal/api';
import { openEnquiryForm, type SupportOpenDetail } from './open-support';

type Mode = 'public' | 'portal';
type Desk = { online: boolean; usualReply: string; message: string; timezone: string; challenge?: string; maxMessage?: number };
type Attachment = { id: string; name: string; mime: string; size?: number; url: string };
type Msg = { id: string; kind: string; content: string; at: string; authorKind: string; senderName: string | null; attachments?: Attachment[] };
type Conv = { id: string; productTitle?: string | null; productSlug?: string | null; convertedLeadRef?: string | null; lastMessageAt?: string | null; lastBody?: string | null; createdAt?: string; messages?: Msg[] };
type Listing = { id: string; productTitle?: string | null; lastMessageAt?: string | null; lastBody?: string | null; convertedLeadRef?: string | null; createdAt?: string };

async function pub<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(path, {
    method, cache: 'no-store', credentials: 'include',
    headers: { ...(headers ?? {}), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body as FormData : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `Something went wrong (${res.status})`);
  return j as T;
}

function authHeaders(): Record<string, string> {
  const t = portalToken.get();
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function readSse(url: string, headers: Record<string, string>, onEvent: (d: { conversationId?: string; sub?: string }) => void, signal: AbortSignal) {
  const res = await fetch(url, { headers: { accept: 'text/event-stream', ...headers }, credentials: 'include', signal, cache: 'no-store' });
  if (!res.ok || !res.body) return;
  const rd = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await rd.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let data = '';
      for (const line of block.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trim();
      if (data) { try { onEvent(JSON.parse(data)); } catch { /* ignore */ } }
    }
  }
}

function mine(m: Msg) { return m.authorKind === 'guest' || m.authorKind === 'customer'; }

function WidgetFile({ file, portal, light }: { file: Attachment; portal: boolean; light: boolean }) {
  const [url, setUrl] = useState(portal ? null as string | null : file.url);
  useEffect(() => {
    if (!portal) return;
    let u: string | null = null, live = true;
    const headers = authHeaders();
    fetch(file.url, { headers, credentials: 'include' }).then(async (res) => {
      if (!res.ok) return;
      const blob = await res.blob();
      u = URL.createObjectURL(blob);
      if (live) setUrl(u);
    }).catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [file.url, portal]);
  const isImg = /^image\//.test(file.mime);
  if (isImg && url) return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.name} className="mt-1 max-h-40 rounded-md" /></a>;
  return <a href={url ?? file.url} target="_blank" rel="noreferrer" className={`mt-1 block text-xs underline ${light ? 'text-white/90' : 'text-brand-700'}`}>{file.name}</a>;
}


/** Floating bottom-right support chat for the public site and the signed-in customer portal. */
export function SupportWidget({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefill, setPrefill] = useState<SupportOpenDetail>({});
  const [conv, setConv] = useState<Conv | null>(null);
  const [history, setHistory] = useState<Listing[] | null>(null);
  const [view, setView] = useState<'form' | 'thread' | 'list'>('form');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState({ website: '', company_url: '', honeypot: '' });
  const [unread, setUnread] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const knownIds = useRef<Set<string>>(new Set());

  const isPortal = mode === 'portal';

  const loadDesk = useCallback(async () => {
    const path = isPortal ? '/api/portal/support/status' : '/api/support/status';
    const r = await pub<{ data: Desk }>('GET', path, undefined, isPortal ? authHeaders() : undefined);
    setDesk(r.data);
    return r.data;
  }, [isPortal]);

  const loadGuest = useCallback(async () => {
    try {
      const r = await pub<{ data: Conv }>('GET', '/api/support/conversation');
      setConv(r.data);
      setView('thread');
      knownIds.current = new Set((r.data.messages ?? []).map((m) => m.id));
      return r.data;
    } catch {
      setConv(null);
      setView('form');
      return null;
    }
  }, []);

  const loadPortalList = useCallback(async () => {
    const r = await pub<{ data: Listing[] }>('GET', '/api/portal/support/conversations', undefined, authHeaders());
    setHistory(r.data);
    return r.data;
  }, []);

  const loadPortalThread = useCallback(async (id: string) => {
    const r = await pub<{ data: Conv }>('GET', `/api/portal/support/conversations/${encodeURIComponent(id)}`, undefined, authHeaders());
    setConv(r.data);
    setView('thread');
    knownIds.current = new Set((r.data.messages ?? []).map((m) => m.id));
    return r.data;
  }, []);

  useEffect(() => { void loadDesk().catch(() => undefined); }, [loadDesk]);

  useEffect(() => {
    if (!isPortal) void loadGuest().catch(() => undefined);
  }, [isPortal, loadGuest]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<SupportOpenDetail>).detail ?? {};
      setPrefill(d);
      setOpen(true);
      if (d.productTitle && !draft) setDraft((cur) => cur || `I'd like to ask about ${d.productTitle}`);
    };
    addEventListener('se:support-open', h);
    return () => removeEventListener('se:support-open', h);
  }, [draft]);

  useEffect(() => {
    if (!open || !isPortal) return;
    void (async () => {
      try {
        const list = await loadPortalList();
        if (conv) return;
        if (list.length === 1) await loadPortalThread(list[0]!.id);
        else if (list.length > 1) setView('list');
        else setView('form');
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [open, isPortal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conv) return;
    const ctl = new AbortController();
    const url = isPortal ? '/api/portal/support/stream' : '/api/support/stream';
    const headers = isPortal ? authHeaders() : {};
    const loop = async () => {
      while (!ctl.signal.aborted) {
        try {
          await readSse(url, headers, (d) => {
            if (d.conversationId && conv && d.conversationId === conv.id) {
              if (isPortal) void loadPortalThread(conv.id);
              else void loadGuest();
            } else if (isPortal) {
              void loadPortalList();
            }
            if (!open) setUnread((n) => n + 1);
          }, ctl.signal);
        } catch { /* retry */ }
        if (!ctl.signal.aborted) await new Promise((r) => setTimeout(r, 3000));
      }
    };
    void loop();
    return () => ctl.abort();
  }, [conv?.id, isPortal, open, loadGuest, loadPortalThread, loadPortalList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages?.length, open]);

  const startGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const status = desk ?? await loadDesk();
      const r = await pub<{ data: Conv & { ok?: boolean } }>('POST', '/api/support/start', {
        name, email, phone, consent, message: draft.trim(),
        challenge: status.challenge,
        productId: prefill.productId, productSlug: prefill.productSlug, productTitle: prefill.productTitle,
        source: prefill.source || 'homepage',
        website: hp.website, company_url: hp.company_url, honeypot: hp.honeypot,
      });
      if ((r.data as { ok?: boolean }).ok && !(r.data as Conv).id) {
        setDraft('');
        setView('form');
        return;
      }
      setConv(r.data);
      setView('thread');
      setDraft('');
      knownIds.current = new Set((r.data.messages ?? []).map((m) => m.id));
    } catch (er) { setErr((er as Error).message); }
    finally { setBusy(false); }
  };

  const startPortal = async (e?: React.FormEvent, opts?: { neu?: boolean }) => {
    e?.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await pub<{ data: Conv }>('POST', '/api/portal/support/start', {
        message: draft.trim(),
        productId: prefill.productId, productSlug: prefill.productSlug, productTitle: prefill.productTitle,
        source: prefill.source || 'portal',
        new: opts?.neu === true,
      }, authHeaders());
      setConv(r.data);
      setView('thread');
      setDraft('');
      await loadPortalList();
    } catch (er) { setErr((er as Error).message); }
    finally { setBusy(false); }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && !files.length) || !conv) return;
    setErr(null);
    setBusy(true);
    try {
      if (isPortal) {
        if (files.length) {
          const fd = new FormData();
          if (text) fd.append('content', text);
          for (const f of files) fd.append('files', f, f.name);
          await pub('POST', `/api/portal/support/conversations/${encodeURIComponent(conv.id)}/messages`, fd, authHeaders());
          await loadPortalThread(conv.id);
        } else {
          await pub('POST', `/api/portal/support/conversations/${encodeURIComponent(conv.id)}/messages`, { content: text }, authHeaders());
          await loadPortalThread(conv.id);
        }
      } else if (files.length) {
        const fd = new FormData();
        if (text) fd.append('content', text);
        for (const f of files) fd.append('files', f, f.name);
        await pub('POST', '/api/support/messages', fd);
        await loadGuest();
      } else {
        await pub('POST', '/api/support/messages', { content: text });
        await loadGuest();
      }
      setDraft('');
      setFiles([]);
    } catch (er) { setErr((er as Error).message); }
    finally { setBusy(false); }
  };

  const bubble = !open && (
    <div className="pointer-events-none fixed z-[60] flex flex-col items-end gap-2 right-4 md:right-6 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6">
      <button type="button" data-testid="support-widget-open" aria-label="Chat with Source Easy"
        onClick={() => { setOpen(true); setUnread(0); }}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-warm-500 text-white shadow-lift hover:bg-warm-600">
        <MessageCircle size={22} />
        {unread > 0 && (
          <span data-testid="support-widget-badge" className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-rose-500 px-1 text-center text-[11px] font-semibold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
    </div>
  );

  const header = (
    <header className="flex shrink-0 items-center gap-2 border-b border-ink-100 bg-brand-700 px-3 py-2.5 text-white">
      {view === 'thread' && isPortal && (
        <button type="button" className="rounded-md px-1 text-white/80 hover:bg-white/10" aria-label="Back" onClick={() => { setView((history && history.length > 0) ? 'list' : 'form'); setConv(null); }}>‹</button>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">Chat with Source Easy</div>
        <div className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${desk?.online ? 'bg-emerald-300' : 'bg-amber-300'}`} />
          {desk?.online ? 'Online' : 'Away'} · {desk?.message ?? 'Leave a message and we will reply.'}
        </div>
      </div>
      <button type="button" className="rounded-md p-1.5 hover:bg-white/10" aria-label="Minimise" onClick={() => setOpen(false)}><Minus size={16} /></button>
      <button type="button" className="rounded-md p-1.5 hover:bg-white/10" aria-label="Close" onClick={() => { setOpen(false); setPrefill({}); }}><X size={16} /></button>
    </header>
  );

  const productChip = (prefill.productTitle || conv?.productTitle) && (
    <div className="border-b border-ink-100 bg-warm-50 px-3 py-2 text-xs text-ink-700" data-testid="support-product-chip">
      About: <span className="font-medium">{prefill.productTitle || conv?.productTitle}</span>
      {prefill.productTitle && (
        <button type="button" className="ml-2 font-medium text-brand-700 hover:underline" onClick={() => openEnquiryForm()}>Or send an enquiry form</button>
      )}
    </div>
  );

  const messages = (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="support-messages">
      {(conv?.messages ?? []).map((m) => (
        <div key={m.id} className={`flex ${mine(m) ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.kind === 'system' ? 'bg-ink-100 text-ink-600' : mine(m) ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-800'}`}>
            {!mine(m) && m.kind !== 'system' && <div className="mb-0.5 text-[10px] font-medium opacity-80">{m.senderName || 'Source Easy team'}</div>}
            {m.content.trim() && <div className="whitespace-pre-wrap break-words">{m.content}</div>}
            {m.attachments?.map((f) => (
              <WidgetFile key={f.id} file={f} portal={isPortal} light={mine(m)} />
            ))}
          </div>
        </div>
      ))}
      {conv?.convertedLeadRef && <p className="text-center text-[11px] text-ink-500">We opened sourcing request {conv.convertedLeadRef} for you.</p>}
      <div ref={bottom} />
    </div>
  );

  const composer = (
    <form className="shrink-0 border-t border-ink-100 p-2" onSubmit={(e) => void send(e)} data-testid="support-composer">
      {files.length > 0 && <div className="mb-1 truncate px-1 text-[11px] text-ink-500">{files.map((f) => f.name).join(', ')}</div>}
      <div className="flex items-end gap-1">
        <button type="button" className="rounded-md p-2 text-ink-500 hover:bg-ink-50" aria-label="Attach a file" onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
        <input ref={fileRef} type="file" hidden multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
        <textarea className="input min-h-[40px] flex-1 resize-none !py-2 text-sm" rows={2} maxLength={desk?.maxMessage ?? 4000}
          value={draft} placeholder="Write a message…" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="submit" disabled={busy || (!draft.trim() && !files.length)} className="rounded-md bg-warm-500 p-2 text-white hover:bg-warm-600 disabled:opacity-50" aria-label="Send"><Send size={16} /></button>
      </div>
    </form>
  );

  const guestForm = (
    <form className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3" onSubmit={(e) => void startGuest(e)} data-testid="support-prechat">
      <p className="text-sm text-ink-600">Tell us how to reach you and we’ll pick up the conversation here.</p>
      <label className="mt-3 text-xs font-medium text-ink-600">Name
        <input className="input mt-1" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="support-name" />
      </label>
      <label className="mt-2 text-xs font-medium text-ink-600">Phone
        <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" data-testid="support-phone" />
      </label>
      <label className="mt-2 text-xs font-medium text-ink-600">Email
        <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="support-email" />
      </label>
      <p className="mt-1 text-[11px] text-ink-400">Enter a phone number or email — one is enough.</p>
      <label className="mt-2 text-xs font-medium text-ink-600">Message
        <textarea className="input mt-1 min-h-[72px]" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={desk?.maxMessage ?? 4000} data-testid="support-first-message" placeholder="How can we help?" />
      </label>
      {/* Honeypot fields — hidden from people, caught on the server. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
        <input tabIndex={-1} autoComplete="off" name="website" value={hp.website} onChange={(e) => setHp({ ...hp, website: e.target.value })} />
        <input tabIndex={-1} autoComplete="off" name="company_url" value={hp.company_url} onChange={(e) => setHp({ ...hp, company_url: e.target.value })} />
        <input tabIndex={-1} autoComplete="off" name="honeypot" value={hp.honeypot} onChange={(e) => setHp({ ...hp, honeypot: e.target.value })} />
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs text-ink-600">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="support-consent" />
        <span>I agree to be contacted about this conversation.</span>
      </label>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      <button type="submit" disabled={busy || !consent} className="btn mt-3 bg-warm-500 text-white hover:bg-warm-600 disabled:opacity-50" data-testid="support-start">{busy ? 'Starting…' : 'Start chat'}</button>
    </form>
  );

  const portalForm = (
    <form className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3" onSubmit={(e) => void startPortal(e)} data-testid="support-portal-start">
      <p className="text-sm text-ink-600">Message the Source Easy team. Your chat history stays with your account.</p>
      <label className="mt-3 text-xs font-medium text-ink-600">Message
        <textarea className="input mt-1 min-h-[96px]" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={desk?.maxMessage ?? 4000} placeholder="How can we help?" data-testid="support-first-message" />
      </label>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      <button type="submit" disabled={busy} className="btn mt-3 bg-warm-500 text-white hover:bg-warm-600 disabled:opacity-50">{busy ? 'Sending…' : 'Start chat'}</button>
    </form>
  );

  const list = (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="support-history">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
        <span className="text-xs font-medium text-ink-500">Your conversations</span>
        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => { setConv(null); setView('form'); setDraft(prefill.productTitle ? `I'd like to ask about ${prefill.productTitle}` : ''); }}>New chat</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(history ?? []).map((c) => (
          <button type="button" key={c.id} className="block w-full border-b border-ink-50 px-3 py-2.5 text-left hover:bg-ink-50" onClick={() => void loadPortalThread(c.id)}>
            <div className="truncate text-sm font-medium text-ink-800">{c.productTitle || 'Support chat'}</div>
            {c.lastBody && <div className="truncate text-xs text-ink-400">{c.lastBody}</div>}
          </button>
        ))}
        {(history ?? []).length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-400">No conversations yet.</p>}
      </div>
    </div>
  );

  return (
    <>
      {bubble}
      {open && (
        <div data-testid={isPortal ? 'support-widget-portal' : 'support-widget'}
          className="fixed inset-0 z-[60] flex flex-col bg-white md:inset-auto md:bottom-6 md:right-6 md:h-[540px] md:w-[360px] md:overflow-hidden md:rounded-2xl md:border md:border-ink-200 md:shadow-lift">
          {header}
          {productChip}
          {err && view !== 'form' && <p className="px-3 py-1 text-xs text-rose-600">{err}</p>}
          {view === 'list' && list}
          {view === 'form' && (isPortal ? portalForm : guestForm)}
          {view === 'thread' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {messages}
              {composer}
            </div>
          )}
        </div>
      )}
    </>
  );
}
