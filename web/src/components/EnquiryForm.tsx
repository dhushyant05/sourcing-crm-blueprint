import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, CheckCircle2, Film, FileSpreadsheet, FileText, ImagePlus, Paperclip, Send, X } from 'lucide-react';

export const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024, MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_EXT = ['mp4', 'm4v', 'mov', '3gp', 'webm', 'mkv'];
export const EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', ...VIDEO_EXT];
export const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.m4v,.mov,.3gp,.webm,.mkv,image/jpeg,image/png,image/webp,image/heic,application/pdf,video/*';
export const isVideoName = (n: string) => VIDEO_EXT.includes((n.split('.').pop() ?? '').toLowerCase());
/** Photos/documents up to 10 MB, videos up to 100 MB (same limits as the server). */
export const tooBig = (f: File) => f.size > (isVideoName(f.name) ? MAX_VIDEO_BYTES : MAX_BYTES);
const CODES = ['+91', '+86', '+971', '+1', '+44', '+65', '+61', '+977', '+880', '+94', '+60', '+966'];
const UNITS = ['pcs', 'kg', 'ton', 'm', 'sqm', 'sets', 'cartons', 'containers'];
const ext = (n: string) => (n.split('.').pop() ?? '').toLowerCase();
export const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export function FileIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const e = ext(name);
  if (VIDEO_EXT.includes(e)) return <Film className={`${className} text-violet-600`} />;
  return e.startsWith('xls') ? <FileSpreadsheet className={`${className} text-accent-600`} /> : <FileText className={`${className} ${e === 'pdf' ? 'text-rose-500' : 'text-brand-600'}`} />;
}

interface Picked { file: File; url?: string }

/** Public sourcing-request form: required mobile number, structured fields, and up to 5 photos/documents. */
export function EnquiryForm() {
  const { t } = useTranslation();
  const l = (k: string, o?: Record<string, unknown>) => t(`landing.contact.${k}`, o);
  const [st, setSt] = useState<'idle' | 'busy' | 'err'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; n: number } | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [drag, setDrag] = useState(false);
  const pick = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { setMsg(l('errCount')); break; }
      if (!EXT.includes(ext(f.name))) { setMsg(l('errType', { name: f.name })); continue; }
      if (tooBig(f)) { setMsg(l('errSize', { name: f.name })); continue; }
      next.push({ file: f, url: /^image\/(jpeg|png|webp)$/.test(f.type) ? URL.createObjectURL(f) : undefined });
    }
    setFiles(next);
  };
  const remove = (i: number) => setFiles((fs) => { if (fs[i].url) URL.revokeObjectURL(fs[i].url!); return fs.filter((_, j) => j !== i); });
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? '').trim();
    const digits = v('phone').replace(/[\s\-().]/g, '');
    if (!v('name') || !v('product') || !digits) return setMsg(l('need'));
    if (!/^\d{6,14}$/.test(digits) || (v('phoneCode') === '+91' && !/^[6-9]\d{9}$/.test(digits))) return setMsg(l('badPhone'));
    if (v('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) return setMsg(l('badEmail'));
    if (v('referenceUrl') && !/^https?:\/\/\S+$/i.test(v('referenceUrl'))) return setMsg(l('badUrl'));
    fd.delete('files'); files.forEach((f) => fd.append('files', f.file, f.file.name));
    setSt('busy');
    try {
      const r = await fetch('/api/public/enquiry', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setDone({ ref: j.reference ?? '', n: j.attachments ?? 0 }); setFiles([]); setSt('idle'); return; }
      setSt('err');
      setMsg(r.status === 429 ? l('tooMany') : j.code === 'phone' ? l('badPhone') : j.code === 'type' || r.status === 415 ? l('errType', { name: '' }) : j.code === 'size' ? l('errSize', { name: '' }) : j.code === 'count' ? l('errCount') : l('err'));
    } catch { setSt('err'); setMsg(l('err')); }
  };

  const fb = 'min-h-[48px] rounded-xl border border-ink-200 bg-white px-4 text-[16px] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10';
  const f = `w-full ${fb}`, fi = `min-w-0 flex-1 ${fb}`;
  const lab = 'mb-1 block text-xs font-medium text-ink-600';
  if (done) return (
    <div data-testid="enquiry-done" className="flex flex-col items-center gap-3 rounded-2xl border border-accent-200 bg-accent-50/40 p-8 text-center shadow-sm lg:col-span-3" role="status">
      <CheckCircle2 className="h-12 w-12 text-accent-600" />
      <h3 className="text-xl font-semibold text-ink-900">{l('okTitle')}</h3>
      <p className="text-sm text-ink-500">{l('okRef')}</p>
      <p data-testid="enquiry-ref" className="select-all rounded-xl border border-ink-200 bg-white px-5 py-2 font-mono text-2xl font-semibold tracking-wider text-brand-700">{done.ref}</p>
      {done.n > 0 && <p className="text-sm text-ink-500">{l('okFiles', { n: done.n })}</p>}
      <p className="max-w-md text-sm text-ink-600">{l('okBody')}</p>
      <button className="mt-2 min-h-[44px] rounded-xl border border-ink-200 px-5 text-sm font-medium text-ink-700 hover:bg-ink-50" onClick={() => setDone(null)}>{l('another')}</button>
    </div>
  );
  return (
    <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl border border-ink-100 p-5 shadow-sm sm:grid-cols-2 sm:p-6 lg:col-span-3" noValidate>
      <div><label className={lab} htmlFor="eq-name">{l('name')}</label><input id="eq-name" name="name" autoComplete="name" required className={f} /></div>
      <div><label className={lab} htmlFor="eq-biz">{l('biz')}</label><input id="eq-biz" name="company" autoComplete="organization" className={f} /></div>
      <div>
        <label className={lab} htmlFor="eq-phone">{l('phone')}</label>
        <div className="flex gap-2">
          <select name="phoneCode" aria-label={l('phoneCode')} defaultValue="+91" className={`${fb} w-[5.75rem] shrink-0 px-2`}>{CODES.map((c) => <option key={c}>{c}</option>)}</select>
          <input id="eq-phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required placeholder="98765 43210" className={fi} />
        </div>
      </div>
      <div><label className={lab} htmlFor="eq-email">{l('email')}</label><input id="eq-email" name="email" type="email" autoComplete="email" className={f} /></div>
      <div className="sm:col-span-2"><label className={lab} htmlFor="eq-product">{l('product')}</label><textarea id="eq-product" name="product" rows={2} required className={`${f} py-3`} /></div>
      <div>
        <label className={lab} htmlFor="eq-qty">{l('qty')}</label>
        <div className="flex gap-2">
          <input id="eq-qty" name="quantity" inputMode="numeric" placeholder="1000" className={fi} />
          <select name="unit" aria-label={l('unit')} defaultValue="pcs" className={`${fb} w-32 shrink-0 px-2`}>{UNITS.map((u) => <option key={u} value={u}>{l(`units.${u}`)}</option>)}</select>
        </div>
      </div>
      <div>
        <label className={lab} htmlFor="eq-price">{l('price')}</label>
        <div className="flex gap-2">
          <select name="currency" aria-label={l('currency')} defaultValue="INR" className={`${fb} w-[6.5rem] shrink-0 px-2`}><option value="INR">₹ INR</option><option value="USD">$ USD</option><option value="CNY">¥ RMB</option></select>
          <input id="eq-price" name="targetPrice" inputMode="decimal" placeholder="0.00" className={fi} />
        </div>
      </div>
      <div><label className={lab} htmlFor="eq-city">{l('dcity')}</label><input id="eq-city" name="deliveryCity" autoComplete="address-level2" placeholder="Chennai" className={f} /></div>
      <div><label className={lab} htmlFor="eq-ref">{l('ref')}</label><input id="eq-ref" name="referenceUrl" type="url" inputMode="url" placeholder={l('refPh')} className={f} /></div>
      <div className="sm:col-span-2"><label className={lab} htmlFor="eq-msg">{l('msg')}</label><textarea id="eq-msg" name="message" rows={3} className={`${f} py-3`} /></div>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="sm:col-span-2">
        <span className={lab}>{l('files')}</span>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-4 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-ink-200'}`}>
          <p className="hidden text-sm text-ink-600 sm:block"><Paperclip className="mr-1 inline h-4 w-4" />{l('drop')} <button type="button" className="font-medium text-brand-600 underline" onClick={() => pick.current?.click()}>{l('browse')}</button></p>
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <button type="button" onClick={() => cam.current?.click()} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-50 font-medium text-brand-700"><Camera size={18} />{l('camera')}</button>
            <button type="button" onClick={() => pick.current?.click()} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-50 font-medium text-brand-700"><ImagePlus size={18} />{l('gallery')}</button>
          </div>
          <p className="mt-2 text-xs text-ink-400">{l('filesHint')}</p>
          <input ref={pick} type="file" multiple accept={ACCEPT} className="hidden" data-testid="file-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>
        {files.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {files.map((p, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-ink-100 p-2">
                {p.url ? <img src={p.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink-50"><FileIcon name={p.file.name} className="h-6 w-6" /></span>}
                <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink-800">{p.file.name}</div><div className="text-xs text-ink-400">{fmtSize(p.file.size)}</div></div>
                <button type="button" aria-label={`${l('remove')} ${p.file.name}`} onClick={() => remove(i)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"><X size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={st === 'busy'} className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-accent-600 px-6 font-medium text-white shadow-md transition hover:brightness-110 disabled:opacity-60 sm:w-auto"><Send size={16} />{st === 'busy' ? l('sending') : l('send')}</button>
        {msg && <p role="alert" className={`text-sm ${st === 'err' ? 'text-rose-600' : 'text-amber-600'}`}>{msg}</p>}
      </div>
    </form>
  );
}
