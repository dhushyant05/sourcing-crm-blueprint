import { useState, type FormEvent } from 'react';
import { publicCatalog } from './api';
import type { Product } from './types';

export function EnquireForm({ product, onDone }: { product?: Product; onDone?: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', phoneCode: '+91', email: '', company: '', quantity: '', message: '', requirement: '', requestLogin: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (!f.name.trim() || !f.phone.trim()) return setMsg({ ok: false, text: 'Name and mobile number are required.' });
    if (!f.email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setMsg({ ok: false, text: 'Please enter a valid email address.' });
    setBusy(true);
    try {
      const r = await publicCatalog.enquire(product?.id, {
        name: f.name.trim(), phone: f.phone.trim(), phoneCode: f.phoneCode, email: f.email.trim(),
        company: f.company.trim() || undefined, quantity: f.quantity ? Number(f.quantity) : undefined,
        message: f.message.trim() || undefined, requirement: !product ? (f.requirement.trim() || undefined) : undefined,
        requestLogin: f.requestLogin,
      });
      setMsg({ ok: true, text: `Request sent. Your reference is ${r.reference}.` });
      onDone?.();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-testid="enquire-form">
      {product ? (
        <p className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700" data-testid="enquire-product">
          Product: <span className="font-medium">{product.title}</span>
        </p>
      ) : (
        <input className="input" placeholder="Product or requirement (optional)" value={f.requirement} onChange={(e) => set('requirement', e.target.value)} data-testid="enquire-requirement" />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" required placeholder="Your name" value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="enquire-name" />
        <input className="input" required type="email" placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} data-testid="enquire-email" />
        <div className="flex gap-2">
          <input className="input w-20" value={f.phoneCode} onChange={(e) => set('phoneCode', e.target.value)} aria-label="Country code" />
          <input className="input flex-1" required placeholder="Mobile number" value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="enquire-phone" />
        </div>
        <input className="input" placeholder="Company" value={f.company} onChange={(e) => set('company', e.target.value)} data-testid="enquire-company" />
        <input className="input" type="number" min="1" placeholder={product ? `Quantity (${product.unit || 'pcs'})` : 'Quantity (optional)'} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} data-testid="enquire-quantity" />
      </div>
      <textarea className="input min-h-[88px]" placeholder="Message (optional)" value={f.message} onChange={(e) => set('message', e.target.value)} data-testid="enquire-message" />
      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={f.requestLogin} onChange={(e) => set('requestLogin', e.target.checked)} /> Request a Customer Portal login
      </label>
      <button className="btn-primary min-h-[44px] px-6" disabled={busy} data-testid="enquire-submit">{busy ? 'Sending…' : 'Request quote'}</button>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'} data-testid="enquire-msg">{msg.text}</p>}
    </form>
  );
}
