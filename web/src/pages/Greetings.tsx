import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useApp } from '../lib/store';
import type { GreetingStaff } from '../lib/types';
import { HttpError } from '../lib/api';
import { SlideOver } from '../components/ui';

// Admin: greeting banners are image-only. The uploaded artwork carries all the text; the server derives the internal name and
// alt text, shows one image on the website, customer portal and customer app (uncropped), and keeps it live until unpublished.
// PNG / JPEG / WebP up to 10 MB (max 8000 px per side, 40 megapixels), checked again on the server.
const MAX = 10 * 1024 * 1024, TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const errKey = (e: unknown) => { const code = e instanceof HttpError ? String(e.body?.code ?? '') : '';
  return ['published', 'incomplete', 'size', 'type', 'state', 'dimensions'].includes(code) ? `gr.err.${code}` : null; };
const showIst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—');
const checkFile = (f: File) => (!TYPES.includes(f.type) ? 'gr.err.type' : f.size > MAX ? 'gr.err.size' : null);

/** Authenticated staff preview of a greeting's artwork (blob URL). */
function useArtwork(g: GreetingStaff | null) {
  const { api } = useApp(); const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true, u: string | null = null; setUrl(null);
    const p = g?.preview.imageDesktop ?? g?.preview.imageMobile;
    if (p) void api.greetingImageUrl!(p).then((x) => { u = x; if (live) setUrl(x); else URL.revokeObjectURL(x); }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); }; }, [api, g?.id, g?.version, g?.preview.imageDesktop, g?.preview.imageMobile]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

export function Greetings() {
  const { api, perms } = useApp(); const { t } = useTranslation();
  const [list, setList] = useState<GreetingStaff[] | null>(null), [open, setOpen] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null), [local, setLocal] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.greetings?.().then(setList).catch((e) => { setErr((e as Error).message); setList([]); }), [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);
  if (!api.greetings || !perms.can('greetings.manage')) return <p className="text-sm text-ink-500">{t('gr.noAccess')}</p>;
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const k = checkFile(f); if (k) { setErr(t(k)); return; } setErr(null); setFile(f); setLocal(URL.createObjectURL(f)); };
  const save = async (publish: boolean) => {
    if (!file) return; setBusy(true); setErr(null);
    try { let g = await api.createImageGreeting!(file); if (publish) g = await api.greetingAction!(g.id, 'publish'); setFile(null); setLocal(null); await load(); setOpen(g.id); }
    catch (e) { const k = errKey(e); setErr(k ? t(k) : (e as Error).message); } finally { setBusy(false); }
  };
  const state = (g: GreetingStaff) => g.status !== 'PUBLISHED' ? t(`gr.st.${g.status}`) : new Date(g.endsAt).getTime() <= Date.now() ? t('gr.expired') : t('gr.live');
  return (
    <div className="space-y-4" data-testid="greetings">
      <h1 className="text-xl font-semibold text-ink-900 dark:text-white">{t('gr.title')}</h1>
      <p className="text-sm text-ink-500">{t('gr.introImage')}</p>
      <div className="card space-y-3 p-4" data-testid="gr-upload-card">
        <label className="btn-primary w-fit cursor-pointer"><ImagePlus size={16} />{t(file ? 'gr.chooseOther' : 'gr.chooseImage')}
          <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" onChange={pick} data-testid="gr-file" /></label>
        <p className="text-xs text-ink-500">{t('gr.imageRules')}</p>
        {local && <div className="space-y-2"><div className="flex items-center gap-2 text-xs font-medium"><Eye size={14} />{t('gr.preview')}</div>
          <img src={local} alt="" className="mx-auto block max-h-[60vh] w-full rounded-xl border border-ink-100 object-contain dark:border-ink-800" data-testid="gr-local-preview" />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="btn-ghost" onClick={() => void save(false)} data-testid="gr-save-draft">{t('gr.saveDraft')}</button>
            {perms.can('greetings.publish') && <button disabled={busy} className="btn-primary" onClick={() => { if (confirm(t('gr.publishConfirm'))) void save(true); }} data-testid="gr-save-publish">{t('gr.savePublish')}</button>}
            <button disabled={busy} className="btn-ghost" onClick={() => { setFile(null); setLocal(null); }}>{t('gr.cancel')}</button></div></div>}
        {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      </div>
      <div className="card p-4">{list === null ? <p className="text-sm text-ink-400">{t('gr.loading')}</p> : !list.length ? <p className="text-sm text-ink-500">{t('gr.none')}</p> :
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">{list.map((g) => <li key={g.id}><button className="flex w-full flex-wrap items-center gap-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800/50" onClick={() => setOpen(g.id)} data-testid={`gr-row-${g.id}`}>
          <span className="font-medium">{g.name}</span><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{state(g)}</span>
          <span className="ml-auto text-xs text-ink-500">{g.updatedByName ?? g.createdByName ?? ''} · {showIst(g.updatedAt)}</span></button></li>)}</ul>}</div>
      {open && <Editor id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </div>
  );
}

function Editor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, perms } = useApp(); const { t } = useTranslation();
  const [g, setG] = useState<GreetingStaff | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void api.greeting!(id).then(setG).catch((e) => setErr((e as Error).message)); }, [api, id]);
  const art = useArtwork(g), locked = g?.status === 'PUBLISHED';
  const run = async (fn: () => Promise<GreetingStaff | void>) => { setBusy(true); setErr(null);
    try { const x = await fn(); if (x) setG(await api.greeting!(x.id)); onChanged(); } catch (e) { const k = errKey(e); setErr(k ? t(k) : (e as Error).message); } finally { setBusy(false); } };
  const replace = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f || !g) return;
    const k = checkFile(f); if (k) { setErr(t(k)); return; } void run(() => api.uploadGreetingImage!(g.id, 'desktop', f)); };
  return (
    <SlideOver open onClose={onClose} title={g ? g.name : t('gr.loading')} subtitle={g ? `${t(`gr.st.${g.status}`)} · v${g.version}` : undefined}>
      <div className="space-y-4 text-sm" data-testid="gr-editor">
        {locked && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('gr.lockedHintImage')}</p>}
        {art ? <img src={art} alt={g?.altText ?? ''} className="mx-auto block max-h-[60vh] w-full rounded-xl border border-ink-100 object-contain dark:border-ink-800" data-testid="gr-preview" />
          : g && <p className="text-xs text-ink-500">{g.layout === 'IMAGE' ? t('gr.noImage') : t('gr.legacy')}</p>}
        {g && !locked && <label className="btn-ghost w-fit cursor-pointer"><Upload size={14} />{t('gr.replaceImage')}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" onChange={replace} data-testid="gr-replace" /></label>}
        {g && <div className="flex flex-wrap gap-2">
          {g.status !== 'PUBLISHED' && (perms.can('greetings.publish') ? <button disabled={busy || !!g.problems.length} className="btn-primary" onClick={() => { if (confirm(t('gr.publishConfirm'))) void run(() => api.greetingAction!(g.id, 'publish')); }} data-testid="gr-publish">{t('gr.publish')}</button>
            : <span className="text-xs text-ink-500">{t('gr.needPublish')}</span>)}
          {g.status === 'PUBLISHED' && <button disabled={busy} className="btn-ghost" onClick={() => void run(() => api.greetingAction!(g.id, 'unpublish'))} data-testid="gr-unpublish">{t('gr.unpublish')}</button>}
          {g.status !== 'PUBLISHED' && <button disabled={busy} className="btn-ghost text-rose-600" onClick={() => { if (confirm(t('gr.deleteConfirm'))) void run(async () => { await api.deleteGreeting!(g.id); onClose(); }); }} data-testid="gr-delete"><Trash2 size={14} />{t('gr.delete')}</button>}
        </div>}
        {g && !!g.problems.length && g.status !== 'PUBLISHED' && <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-200" data-testid="gr-problems">{g.problems.map((p, i) => <li key={p}>{t(`gr.problem.${g.problemCodes?.[i] ?? 'other'}`, { defaultValue: p })}</li>)}</ul>}
        {g?.audit && <div><div className="mb-1 text-xs font-medium">{t('gr.audit')}</div><ol className="space-y-1 border-l-2 border-ink-100 pl-3 text-xs dark:border-ink-800">{[...g.audit].reverse().map((a, i) =>
          <li key={i}><span className="font-medium">{t(`gr.act.${a.action}`, { defaultValue: a.action })}</span>{a.by && <span className="text-ink-500"> · {a.by}</span>} <span className="text-ink-400">{showIst(a.at)}</span></li>)}</ol></div>}
        {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      </div>
    </SlideOver>
  );
}
