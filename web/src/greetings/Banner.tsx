import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/** Customer-safe greeting as delivered by /api/public/greetings and /api/portal/greetings. Text is always rendered as text, never HTML. */
export interface Greeting { id: string; version: number; layout: 'IMAGE' | 'CLASSIC' | 'FESTIVE' | 'MINIMAL'; theme: 'BRAND' | 'GOLD' | 'NIGHT' | 'ROSE';
  heading: string | null; message: string | null; alt: string | null; link: { path: string; label: string | null } | null;
  imageDesktop: string | null; imageMobile: string | null; dismissible: boolean; startsAt: string; endsAt: string; priority: number }

const THEME: Record<Greeting['theme'], string> = {
  BRAND: 'from-brand-600 to-accent-500 text-white', GOLD: 'from-amber-500 to-orange-600 text-white', NIGHT: 'from-ink-900 to-indigo-900 text-white', ROSE: 'from-rose-500 to-fuchsia-600 text-white' };

const DISMISS = 'se.greet.dismissed';
const dismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISS) ?? '[]'); } catch { return []; } };
export const isDismissed = (g: Greeting) => dismissed().includes(`${g.id}:${g.version}`);
export const dismiss = (g: Greeting) => localStorage.setItem(DISMISS, JSON.stringify([...dismissed().filter((k) => !k.startsWith(`${g.id}:`)), `${g.id}:${g.version}`].slice(-50)));
/** Client-side expiry: a cached greeting is dropped as soon as its window ends, even offline. */
export const isCurrent = (g: Greeting, now = Date.now()) => new Date(g.startsAt).getTime() <= now && new Date(g.endsAt).getTime() > now;
const safeLink = (p?: string | null) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null);

/** Fetches a feed, caches it (≤ 1 h) and returns the top greeting not dismissed and still inside its window. */
export function useGreeting(cacheKey: string, load: () => Promise<Greeting[]>) {
  const [list, setList] = useState<Greeting[]>(() => { try { const c = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); return c && Date.now() - c.at < 3600e3 ? c.data : []; } catch { return []; } });
  const [, bump] = useState(0);
  useEffect(() => { let live = true; load().then((d) => { if (!live) return; setList(d); localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: d })); }).catch(() => undefined);
    const t = setInterval(() => bump((n) => n + 1), 60e3); return () => { live = false; clearInterval(t); }; }, [cacheKey, load]);
  const g = list.filter((x) => isCurrent(x) && !isDismissed(x)).sort((a, b) => b.priority - a.priority)[0] ?? null;
  return { greeting: g, close: () => { if (g) { dismiss(g); bump((n) => n + 1); } } };
}

/** Responsive banner: artwork via <picture> (mobile ≤ 640px), or one of three preset layouts. */
export function GreetingBanner({ g, img, onClose, preview }: { g: Greeting; img?: { desktop: string | null; mobile: string | null }; onClose?: () => void; preview?: 'desktop' | 'mobile' }) {
  const d = img?.desktop ?? g.imageDesktop, m = img?.mobile ?? g.imageMobile ?? d;
  const link = safeLink(g.link?.path);
  const close = g.dismissible && onClose && <button type="button" onClick={onClose} aria-label="Dismiss greeting" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/30 text-white hover:bg-black/50"><X size={16} /></button>;
  const pic = d && <picture>{m && !preview && <source media="(max-width: 640px)" srcSet={m} />}<img src={preview === 'mobile' ? m ?? d : d} alt={g.alt ?? ''} className="h-full w-full object-cover" /></picture>;
  const cta = link && <a href={link} className="mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-white/95 px-4 text-sm font-medium text-ink-900 hover:bg-white">{g.link?.label || 'Learn more'}</a>;
  const narrow = preview === 'mobile';
  let body;
  if (g.layout === 'IMAGE') body = link ? <a href={link} className="block">{pic}</a> : pic;
  else if (g.layout === 'MINIMAL') body = <div className={`flex flex-wrap items-center gap-3 bg-gradient-to-r px-4 py-3 pr-12 ${THEME[g.theme]}`}><strong>{g.heading}</strong>{g.message && <span className="text-sm opacity-90">{g.message}</span>}{link && <a href={link} className="text-sm font-medium underline">{g.link?.label || 'Learn more'}</a>}</div>;
  else if (g.layout === 'FESTIVE') body = <div className={`relative overflow-hidden bg-gradient-to-br ${THEME[g.theme]}`}>
      {d && <div className="absolute inset-0 opacity-35">{pic}</div>}
      <div className={`relative px-6 py-8 pr-12 text-center ${narrow ? '' : 'sm:py-12'}`}><p className={`font-semibold tracking-tight ${narrow ? 'text-2xl' : 'text-2xl sm:text-4xl'}`}>{g.heading}</p>{g.message && <p className="mx-auto mt-2 max-w-2xl opacity-90">{g.message}</p>}{cta}</div></div>;
  else body = <div className={`grid bg-gradient-to-r ${THEME[g.theme]} ${narrow ? '' : 'sm:grid-cols-[2fr_3fr]'}`}>
      {d && <div className={`h-40 ${narrow ? '' : 'sm:h-auto'}`}>{pic}</div>}
      <div className="px-6 py-6 pr-12"><p className="text-xl font-semibold">{g.heading}</p>{g.message && <p className="mt-1 opacity-90">{g.message}</p>}{cta}</div></div>;
  return <aside role="region" aria-label="Greeting" data-testid="greeting-banner" className="relative overflow-hidden rounded-2xl shadow-sm">{body}{close}</aside>;
}
