import { useState, type FormEvent } from 'react';
import { publicCatalog } from './api';
import type { Product } from './types';

export function EnquireForm({ product, onDone }: { product: Product; onDone?: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', phoneCode: '+91', company: '', quantity: '', message: '', requestLogin: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await publicCatalog.enquire(product.id, { ...f, quantity: f.quantity ? Number(f.quantity) : undefined });
      setMsg({ ok: true, text: `Request sent. Your reference is ${r.reference}.` });
      onDone?.();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-testid="enquire-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" required placeholder="Your name" value={f.name} onChange={(e) => set('name', e.target.value)} />
        <div className="flex gap-2">
          <input className="input w-20" value={f.phoneCode} onChange={(e) => set('phoneCode', e.target.value)} aria-label="Country code" />
          <input className="input flex-1" required placeholder="Mobile number" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <input className="input" placeholder="Company" value={f.company} onChange={(e) => set('company', e.target.value)} />
        <input className="input" type="number" min="1" placeholder={`Quantity (${product.unit || 'pcs'})`} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
      </div>
      <textarea className="input min-h-[88px]" placeholder="Message (optional)" value={f.message} onChange={(e) => set('message', e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={f.requestLogin} onChange={(e) => set('requestLogin', e.target.checked)} /> Request a Customer Portal login
      </label>
      <button className="btn-primary min-h-[44px] px-6" disabled={busy} data-testid="enquire-submit">{busy ? 'Sending…' : 'Request quote'}</button>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'} data-testid="enquire-msg">{msg.text}</p>}
    </form>
  );
}
