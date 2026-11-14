import { useState, type FormEvent } from 'react';
import { publicCatalog } from './api';
import type { Product } from './types';
import { EXT, MAX_FILES, fmtSize, tooBig } from '../components/EnquiryForm';
const DOC_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp,application/pdf';

type QuoteType = 'SOURCING' | 'SHIPPING';
type FileKind = 'photos' | 'invoices' | 'packingLists';
const FILE_FIELDS: { key: FileKind; label: string }[] = [
  { key: 'photos', label: 'Photos' },
  { key: 'invoices', label: 'Invoice' },
  { key: 'packingLists', label: 'Packing list' },
];
const MODES: [string, string][] = [['', 'Not sure'], ['SEA', 'Sea'], ['AIR', 'Air'], ['EXPRESS', 'Courier / express'], ['ROAD', 'Road']];

const empty = {
  name: '', phone: '', phoneCode: '+91', email: '', company: '', quantity: '', unit: 'pcs', message: '', requirement: '', requestLogin: false,
  goods: '', packages: '', weightKg: '', cbm: '', shipperName: '', shipperPhone: '', pickupCity: '', pickupAddress: '',
  destCity: '', destAddress: '', destPincode: '', mode: '', readyDate: '',
};

export function EnquireForm({ product, onDone }: { product?: Product; onDone?: () => void }) {
  const [kind, setKind] = useState<QuoteType>('SOURCING');
  const [f, setF] = useState(empty);
  const [files, setFiles] = useState<Record<FileKind, File[]>>({ photos: [], invoices: [], packingLists: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const allFiles = () => FILE_FIELDS.flatMap((x) => files[x.key]);
  const addFiles = (key: FileKind, list: FileList | null) => {
    if (!list) return;
    setMsg(null);
    const used = allFiles().length;
    const next = [...files[key]];
    for (const file of Array.from(list)) {
      if (used + next.length - files[key].length >= MAX_FILES) { setMsg({ ok: false, text: `You can attach up to ${MAX_FILES} files in total.` }); break; }
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (!EXT.includes(ext) || ['mp4', 'm4v', 'mov', '3gp', 'webm', 'mkv'].includes(ext)) { setMsg({ ok: false, text: `File type not allowed: ${file.name}. Use a photo, PDF, Word or Excel file.` }); continue; }
      if (tooBig(file)) { setMsg({ ok: false, text: `Too large: ${file.name} (10 MB maximum).` }); continue; }
      next.push(file);
    }
    setFiles((s) => ({ ...s, [key]: next }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (!f.name.trim() || !f.phone.trim()) return setMsg({ ok: false, text: 'Name and mobile number are required.' });
    if (!f.email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setMsg({ ok: false, text: 'Please enter a valid email address.' });
    if (kind === 'SHIPPING') {
      if (!f.destCity.trim()) return setMsg({ ok: false, text: 'Destination city is required.' });
      if (!f.pickupCity.trim() && !f.pickupAddress.trim()) return setMsg({ ok: false, text: 'Pickup city or address is required.' });
      if (!product && !f.goods.trim() && !f.requirement.trim()) return setMsg({ ok: false, text: 'Describe the goods to ship.' });
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        type: kind, name: f.name.trim(), phone: f.phone.trim(), phoneCode: f.phoneCode, email: f.email.trim(),
        company: f.company.trim() || undefined, quantity: f.quantity ? Number(f.quantity) : undefined, unit: f.unit || undefined,
        message: f.message.trim() || undefined, requestLogin: f.requestLogin,
      };
      if (kind === 'SOURCING') body.requirement = !product ? (f.requirement.trim() || undefined) : undefined;
      else {
        body.goods = f.goods.trim() || f.requirement.trim() || product?.title;
        body.packages = f.packages || undefined; body.weightKg = f.weightKg || undefined; body.cbm = f.cbm || undefined;
        body.shipperName = f.shipperName.trim() || undefined; body.shipperPhone = f.shipperPhone.trim() || undefined;
        body.pickupCity = f.pickupCity.trim() || undefined; body.pickupAddress = f.pickupAddress.trim() || undefined;
        body.destCity = f.destCity.trim(); body.destAddress = f.destAddress.trim() || undefined; body.destPincode = f.destPincode.trim() || undefined;
        body.mode = f.mode || undefined; body.readyDate = f.readyDate || undefined;
      }
      const attachments = FILE_FIELDS.flatMap((x) => files[x.key].map((file) => ({ field: x.key, file })));
      const r = await publicCatalog.enquire(product?.id, body, attachments);
      const where = r.kind === 'SHIPPING' ? 'shipping request' : 'lead';
      setMsg({ ok: true, text: `Request sent as a ${where}. Your reference is ${r.reference}.` });
      onDone?.();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="enquire-form">
      <div role="radiogroup" aria-label="What do you need?" className="grid grid-cols-2 gap-2">
        {([['SOURCING', 'Product sourcing'], ['SHIPPING', 'Shipping']] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`quote-type-${k}`}
            onClick={() => { setKind(k); setMsg(null); }}
            className={`min-h-[44px] rounded-xl border px-3 text-sm font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600'}`}>{label}</button>
        ))}
      </div>
      {product ? (
        <p className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700" data-testid="enquire-product">
          Product: <span className="font-medium">{product.title}</span>
        </p>
      ) : kind === 'SOURCING' ? (
        <input className="input" placeholder="Product or requirement (optional)" value={f.requirement} onChange={(e) => set('requirement', e.target.value)} data-testid="enquire-requirement" />
      ) : (
        <textarea className="input min-h-[72px]" required placeholder="Goods to ship *" value={f.goods} onChange={(e) => set('goods', e.target.value)} data-testid="enquire-goods" />
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
        {kind === 'SHIPPING' && <input className="input" placeholder="Unit (cartons, pcs…)" value={f.unit} onChange={(e) => set('unit', e.target.value)} />}
      </div>
      {kind === 'SHIPPING' && (
        <div className="space-y-3 rounded-xl border border-ink-100 bg-ink-50/60 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="input" type="number" min="1" placeholder="Cartons / packages" value={f.packages} onChange={(e) => set('packages', e.target.value)} data-testid="enquire-packages" />
            <input className="input" type="number" min="0" step="0.01" placeholder="Weight (kg)" value={f.weightKg} onChange={(e) => set('weightKg', e.target.value)} data-testid="enquire-weight" />
            <input className="input" type="number" min="0" step="0.01" placeholder="Volume (CBM)" value={f.cbm} onChange={(e) => set('cbm', e.target.value)} data-testid="enquire-cbm" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Pickup</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Pickup city *" value={f.pickupCity} onChange={(e) => set('pickupCity', e.target.value)} data-testid="enquire-pickup-city" />
            <input className="input" placeholder="Shipper name" value={f.shipperName} onChange={(e) => set('shipperName', e.target.value)} />
            <input className="input sm:col-span-2" placeholder="Pickup address" value={f.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} data-testid="enquire-pickup-address" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Destination</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" required placeholder="Destination city *" value={f.destCity} onChange={(e) => set('destCity', e.target.value)} data-testid="enquire-dest-city" />
            <input className="input" placeholder="Pincode" value={f.destPincode} onChange={(e) => set('destPincode', e.target.value)} />
            <input className="input sm:col-span-2" placeholder="Destination address" value={f.destAddress} onChange={(e) => set('destAddress', e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="input" value={f.mode} onChange={(e) => set('mode', e.target.value)} aria-label="Shipping mode">{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <input className="input" type="date" value={f.readyDate} onChange={(e) => set('readyDate', e.target.value)} aria-label="Ready date" />
          </div>
        </div>
      )}
      <textarea className="input min-h-[88px]" placeholder="Message (optional)" value={f.message} onChange={(e) => set('message', e.target.value)} data-testid="enquire-message" />
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink-800">Attachments <span className="font-normal text-ink-500">(optional, up to {MAX_FILES} files, 10 MB each — photos, PDF, Word or Excel)</span></p>
        {FILE_FIELDS.map((x) => (
          <div key={x.key}>
            <label className="mb-1 block text-xs font-medium text-ink-600">{x.label}</label>
            <input type="file" multiple accept={DOC_ACCEPT} data-testid={`enquire-files-${x.key}`} className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(e) => { addFiles(x.key, e.target.files); e.target.value = ''; }} />
            {files[x.key].length > 0 && (
              <ul className="mt-1 space-y-1 text-sm">{files[x.key].map((file, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-1.5">
                  <span className="truncate">{file.name} <span className="text-xs text-ink-400">{fmtSize(file.size)}</span></span>
                  <button type="button" className="text-xs text-ink-500 hover:text-rose-600" onClick={() => setFiles((s) => ({ ...s, [x.key]: s[x.key].filter((_, j) => j !== i) }))}>Remove</button>
                </li>
              ))}</ul>
            )}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input type="checkbox" checked={f.requestLogin} onChange={(e) => set('requestLogin', e.target.checked)} /> Request a Customer Portal login
      </label>
      <button className="btn-primary min-h-[44px] px-6" disabled={busy} data-testid="enquire-submit">{busy ? 'Sending…' : 'Request quote'}</button>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'} data-testid="enquire-msg">{msg.text}</p>}
    </form>
  );
}
