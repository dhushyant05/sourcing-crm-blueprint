import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Monitor, Plus, Smartphone, Trash2, Upload } from 'lucide-react';
import { useApp } from '../lib/store';
import type { GreetingStaff } from '../lib/types';
import { HttpError } from '../lib/api';
import { SlideOver } from '../components/ui';
import { GreetingBanner } from '../greetings/Banner';

// Admin: festival / event greeting banners for the public site, the customer portal and the customer app.
// Plain text + uploaded PNG/JPEG/WebP only (no HTML / SVG / scripts). Times are entered and shown in IST.
const LAYOUTS = ['FESTIVE', 'CLASSIC', 'MINIMAL', 'IMAGE'] as const, THEMES = ['BRAND', 'GOLD', 'NIGHT', 'ROSE'] as const, SURFACES = ['PUBLIC', 'PORTAL', 'APP'] as const;
// Server validation messages → translated keys (fallback: by error code, then the server text).
const MSG: Record<string, string> = { 'Link must be a path on our site, like /portal': 'link', 'Name is required': 'name', 'Unknown layout': 'layout', 'Unknown theme': 'theme',
  'Choose where to show it: PUBLIC, PORTAL, APP': 'surfaces', 'Priority must be 0–100': 'priority', 'End must be after start': 'window', 'This greeting changed, refresh and try again': 'state',
  'Unpublish this greeting before editing it': 'published' };
const errKey = (e: unknown) => { const m = (e as Error).message; const code = e instanceof HttpError ? String(e.body?.code ?? '') : '';
  return MSG[m] ? `gr.err.${MSG[m]}` : code && ['published', 'incomplete', 'size', 'type', 'state', 'invalid', 'required'].includes(code) ? `gr.err.${code}` : null; };
const toIst = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
const showIst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—');

export function Greetings() {
  const { api, perms } = useApp(); const { t } = useTranslation();
  const [list, setList] = useState<GreetingStaff[] | null>(null), [open, setOpen] = useState<string | 'new' | null>(null), [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.greetings?.().then(setList).catch((e) => { setErr((e as Error).message); setList([]); }), [api]);
  useEffect(() => { void load(); }, [load]);
  if (!api.greetings || !perms.can('greetings.manage')) return <p className="text-sm text-ink-500">{t('gr.noAccess')}</p>;
  const now = Date.now();
  const state = (g: GreetingStaff) => g.status !== 'PUBLISHED' ? t(`gr.st.${g.status}`) : new Date(g.endsAt).getTime() <= now ? t('gr.expired') : new Date(g.startsAt).getTime() > now ? t('gr.scheduled') : t('gr.live');
  return (
    <div className="space-y-4" data-testid="greetings">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-ink-900 dark:text-white">{t('gr.title')}</h1>
        <button className="btn-primary ml-auto" onClick={() => setOpen('new')} data-testid="gr-new"><Plus size={16} />{t('gr.new')}</button></div>
      <p className="text-sm text-ink-500">{t('gr.intro')}</p>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="card overflow-x-auto p-4">{list === null ? <p className="text-sm text-ink-400">{t('gr.loading')}</p> : !list.length ? <p className="text-sm text-ink-500">{t('gr.none')}</p> :
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-500"><th className="py-1 pr-3">{t('gr.name')}</th><th className="pr-3">{t('gr.status')}</th><th className="pr-3">{t('gr.where')}</th><th className="pr-3">{t('gr.window')}</th><th className="pr-3">{t('gr.priority')}</th><th>{t('gr.updated')}</th></tr></thead>
          <tbody>{list.map((g) => <tr key={g.id} className="cursor-pointer border-t border-ink-100 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => setOpen(g.id)} data-testid={`gr-row-${g.id}`}>
            <td className="py-2 pr-3 font-medium">{g.name}</td><td className="pr-3"><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{state(g)}</span></td>
            <td className="pr-3 text-xs">{g.surfaces.map((s) => t(`gr.surface.${s}`)).join(', ')}</td><td className="pr-3 text-xs">{showIst(g.startsAt)} → {showIst(g.endsAt)}</td>
            <td className="pr-3 text-xs">{g.priority}</td><td className="text-xs text-ink-500">{g.updatedByName ?? g.createdByName ?? ''} · {showIst(g.updatedAt)}</td></tr>)}</tbody></table>}</div>
      {open && <Editor id={open === 'new' ? null : open} onClose={() => setOpen(null)} onChanged={(id) => { void load(); if (id) setOpen(id); }} />}
    </div>
  );
}

function Editor({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: (id?: string) => void }) {
  const { api, perms } = useApp(); const { t } = useTranslation();
  const [g, setG] = useState<GreetingStaff | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const start = new Date(), end = new Date(Date.now() + 3 * 864e5);
  const [f, setF] = useState<Record<string, any>>({ name: '', layout: 'FESTIVE', theme: 'GOLD', heading: '', message: '', altText: '', linkPath: '', linkLabel: '', surfaces: ['PUBLIC', 'PORTAL', 'APP'],
    startsAt: toIst(start.toISOString()), endsAt: toIst(end.toISOString()), priority: 0, dismissible: true });
  const [img, setImg] = useState<{ desktop: string | null; mobile: string | null }>({ desktop: null, mobile: null });
  const fill = (x: GreetingStaff) => { setG(x); setF({ name: x.name, layout: x.layout, theme: x.theme, heading: x.heading ?? '', message: x.message ?? '', altText: x.altText ?? '', linkPath: x.linkPath ?? '', linkLabel: x.linkLabel ?? '',
    surfaces: x.surfaces, startsAt: toIst(x.startsAt), endsAt: toIst(x.endsAt), priority: x.priority, dismissible: x.dismissible }); };
  useEffect(() => { if (id) void api.greeting!(id).then(fill).catch((e) => setErr((e as Error).message)); }, [api, id]);
  // Staff preview images come from the authenticated staff route, as blob URLs.
  useEffect(() => { let live = true; const urls: string[] = [];
    const get = async (p: string | null) => { if (!p) return null; try { const u = await api.greetingImageUrl!(p); urls.push(u); return u; } catch { return null; } };
    if (g) void Promise.all([get(g.preview.imageDesktop), get(g.preview.imageMobile)]).then(([desktop, mobile]) => { if (live) setImg({ desktop, mobile }); });
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); }; }, [api, g]);
  const locked = g?.status === 'PUBLISHED';
  const run = async (fn: () => Promise<GreetingStaff | void>) => { setBusy(true); setErr(null); try { const x = await fn(); if (x) { const full = await api.greeting!(x.id); fill(full); onChanged(x.id); } else onChanged(); } catch (e) { const k = errKey(e); setErr(k ? t(k) : (e as Error).message); } finally { setBusy(false); } };
  const body = () => ({ ...f, priority: Number(f.priority) || 0, linkPath: f.linkPath || null, linkLabel: f.linkLabel || null });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const upload = (kind: 'desktop' | 'mobile') => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (file && g) void run(() => api.uploadGreetingImage!(g.id, kind, file)); };
  const preview = { ...(g?.preview ?? { id: 'new', version: 0, imageDesktop: null, imageMobile: null, startsAt: '', endsAt: '', priority: 0 }), layout: f.layout, theme: f.theme, heading: f.heading, message: f.message, alt: f.altText,
    link: f.linkPath ? { path: f.linkPath, label: f.linkLabel } : null, dismissible: f.dismissible } as GreetingStaff['preview'];
  const txt = (k: string, label: string, max: number, area = false) => <label className="block text-xs">{label}{area ? <textarea className="input" rows={2} maxLength={max} value={f[k]} disabled={locked} onChange={set(k)} data-testid={`gr-${k}`} />
    : <input className="input" maxLength={max} value={f[k]} disabled={locked} onChange={set(k)} data-testid={`gr-${k}`} />}</label>;
  return (
    <SlideOver open onClose={onClose} title={g ? g.name : t('gr.new')} subtitle={g ? `${t(`gr.st.${g.status}`)} · v${g.version}` : undefined}>
      <div className="space-y-4 text-sm" data-testid="gr-editor">
        {locked && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('gr.lockedHint')}</p>}
        {txt('name', t('gr.nameInternal'), 120)}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">{t('gr.layout')}<select className="input" value={f.layout} disabled={locked} onChange={set('layout')} data-testid="gr-layout">{LAYOUTS.map((l) => <option key={l} value={l}>{t(`gr.layouts.${l}`)}</option>)}</select></label>
          <label className="text-xs">{t('gr.theme')}<select className="input" value={f.theme} disabled={locked} onChange={set('theme')}>{THEMES.map((l) => <option key={l} value={l}>{t(`gr.themes.${l}`)}</option>)}</select></label>
        </div>
        {txt('heading', t('gr.heading'), 120)}{txt('message', t('gr.message'), 400, true)}{txt('altText', t('gr.alt'), 200)}
        <div className="grid grid-cols-2 gap-2">{txt('linkPath', t('gr.linkPath'), 200)}{txt('linkLabel', t('gr.linkLabel'), 40)}</div>
        <p className="text-[11px] text-ink-500">{t('gr.textHint')}</p>
        <fieldset className="flex flex-wrap gap-3 text-xs"><legend className="mb-1">{t('gr.where')}</legend>{SURFACES.map((s) => <label key={s} className="flex items-center gap-1">
          <input type="checkbox" disabled={locked} checked={f.surfaces.includes(s)} onChange={(e) => setF((x) => ({ ...x, surfaces: e.target.checked ? [...x.surfaces, s] : x.surfaces.filter((y: string) => y !== s) }))} />{t(`gr.surface.${s}`)}</label>)}</fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">{t('gr.starts')}<input className="input" type="datetime-local" disabled={locked} value={f.startsAt} onChange={set('startsAt')} data-testid="gr-starts" /></label>
          <label className="text-xs">{t('gr.ends')}<input className="input" type="datetime-local" disabled={locked} value={f.endsAt} onChange={set('endsAt')} data-testid="gr-ends" /></label>
          <label className="text-xs">{t('gr.priority')}<input className="input" type="number" min={0} max={100} disabled={locked} value={f.priority} onChange={set('priority')} /></label>
          <label className="flex items-center gap-2 pt-5 text-xs"><input type="checkbox" disabled={locked} checked={f.dismissible} onChange={(e) => setF((x) => ({ ...x, dismissible: e.target.checked }))} />{t('gr.dismissible')}</label>
        </div>
        {!locked && <button disabled={busy || !f.name.trim()} className="btn-primary" onClick={() => void run(() => api.saveGreeting!(body(), g?.id))} data-testid="gr-save">{t(g ? 'gr.save' : 'gr.create')}</button>}
        {g && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="text-xs font-medium">{t('gr.artwork')}</div><p className="text-[11px] text-ink-500">{t('gr.artworkHint')}</p>
          {(['desktop', 'mobile'] as const).map((k) => <div key={k} className="flex flex-wrap items-center gap-2 text-xs">{k === 'desktop' ? <Monitor size={14} /> : <Smartphone size={14} />}{t(`gr.img.${k}`)}:
            <span className="text-ink-500">{(k === 'desktop' ? g.imageDesktop : g.imageMobile) ? t('gr.uploaded') : t('gr.noImage')}</span>
            {!locked && <label className="btn-ghost cursor-pointer !py-1 text-xs"><Upload size={13} />{t('gr.upload')}<input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={upload(k)} data-testid={`gr-upload-${k}`} /></label>}
            {!locked && (k === 'desktop' ? g.imageDesktop : g.imageMobile) && <button className="btn-ghost !py-1 text-xs" onClick={() => void run(() => api.removeGreetingImage!(g.id, k))}><Trash2 size={13} /></button>}</div>)}</div>}
        <div className="space-y-2"><div className="flex items-center gap-2 text-xs font-medium"><Eye size={14} />{t('gr.preview')}
          <div className="ml-auto flex gap-1">{(['desktop', 'mobile'] as const).map((v) => <button key={v} className={view === v ? 'btn-primary !py-1 text-xs' : 'btn-ghost !py-1 text-xs'} onClick={() => setView(v)}>{t(`gr.img.${v}`)}</button>)}</div></div>
          <div className={view === 'mobile' ? 'mx-auto w-[360px] max-w-full' : ''} data-testid="gr-preview"><GreetingBanner g={preview} img={img} preview={view} onClose={() => undefined} /></div>
          <p className="text-[11px] text-ink-500">{t('gr.previewHint')}</p></div>
        {g && !!g.problems.length && g.status !== 'PUBLISHED' && <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-200" data-testid="gr-problems">{g.problems.map((p, i) => <li key={p}>{t(`gr.problem.${g.problemCodes?.[i] ?? 'other'}`, { defaultValue: p })}</li>)}</ul>}
        {g && <div className="flex flex-wrap gap-2">
          {g.status !== 'PUBLISHED' && (perms.can('greetings.publish') ? <button disabled={busy || !!g.problems.length} className="btn-primary" onClick={() => { if (confirm(t('gr.publishConfirm'))) void run(() => api.greetingAction!(g.id, 'publish')); }} data-testid="gr-publish">{t('gr.publish')}</button>
            : <span className="text-xs text-ink-500">{t('gr.needPublish')}</span>)}
          {g.status === 'PUBLISHED' && <button disabled={busy} className="btn-ghost" onClick={() => void run(() => api.greetingAction!(g.id, 'unpublish'))} data-testid="gr-unpublish">{t('gr.unpublish')}</button>}
          {g.status !== 'PUBLISHED' && <button disabled={busy} className="btn-ghost text-rose-600" onClick={() => { if (confirm(t('gr.deleteConfirm'))) void run(async () => { await api.deleteGreeting!(g.id); onClose(); }); }}>{t('gr.delete')}</button>}
        </div>}
        {g?.audit && <div><div className="mb-1 text-xs font-medium">{t('gr.audit')}</div><ol className="space-y-1 border-l-2 border-ink-100 pl-3 text-xs dark:border-ink-800">{[...g.audit].reverse().map((a, i) =>
          <li key={i}><span className="font-medium">{t(`gr.act.${a.action}`, { defaultValue: a.action })}</span>{a.by && <span className="text-ink-500"> · {a.by}</span>} <span className="text-ink-400">{showIst(a.at)}</span></li>)}</ol></div>}
        {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      </div>
    </SlideOver>
  );
}
