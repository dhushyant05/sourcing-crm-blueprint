import { clsx } from 'clsx';
import { X, Inbox } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useApp } from '../lib/store';

const tone: Record<string, string> = {
  NEW: 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300',
  ASSIGNED: 'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300',
  SOURCING: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300',
  QUOTED: 'bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200',
  APPROVED: 'bg-teal-50 text-teal-700 ring-teal-600/15 dark:bg-teal-500/10 dark:text-teal-300',
  SHIPPING: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15 dark:bg-cyan-500/10 dark:text-cyan-300',
  WON: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300',
  DELIVERED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300',
  LOST: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300',
  AT_PORT: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300',
};
export const dot: Record<string, string> = {
  NEW: 'bg-sky-500', ASSIGNED: 'bg-violet-500', SOURCING: 'bg-amber-500', QUOTED: 'bg-brand-500',
  APPROVED: 'bg-teal-500', SHIPPING: 'bg-cyan-500', WON: 'bg-emerald-500', LOST: 'bg-rose-500',
};
/** Translated label for a status enum (falls back to "In transit"-style prettifying). */
export const pretty = (s: string) => i18n.t(`status.${s}`, { defaultValue: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') });

export function Chip({ value }: { value: string }) {
  useTranslation();
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
      tone[value] ?? 'bg-ink-100 text-ink-600 ring-ink-500/15 dark:bg-ink-800 dark:text-ink-300')}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', dot[value] ?? 'bg-current opacity-60')} />
      {pretty(value)}
    </span>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={clsx('skeleton', className)} />;

export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">{Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-5 flex-1" />)}</div>
      ))}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center animate-fade-in">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800"><Inbox size={22} /></div>
      <p className="font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink-500">{hint}</p>}
      {action}
    </div>
  );
}

export function Sparkline({ data, color = '#2a9fd6' }: { data: number[]; color?: string }) {
  const w = 120, h = 36, max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const id = `g${color.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-28" preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SlideOver({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  if (!open) return null;
  // Portal: escapes the animated (transformed) page container so `fixed` spans the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink-900/20 backdrop-blur-[2px] animate-fade-in dark:bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-ink-200 bg-white shadow-lift animate-slide-in dark:border-ink-800 dark:bg-ink-900">
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-5 dark:border-ink-800">
          <div><h2 className="text-base font-semibold text-ink-900 dark:text-white">{title}</h2>{subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}</div>
          <button aria-label={i18n.t('common.close')} onClick={onClose} className="btn-ghost -mr-2 p-2"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-ink-100 px-6 py-4 dark:border-ink-800">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="text-ink-500">{label}</dt><dd className="text-right font-medium text-ink-800 dark:text-ink-100">{children ?? '—'}</dd>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}</div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

/** Initials bubble, or the person's picture. `person` looks the name up in the staff picture map. */
export const Avatar = ({ name, className, src, person }: { name: string; className?: string; src?: string | null; person?: boolean }) => {
  const { people } = useApp();
  const img = src ?? (person ? people[name] : undefined);
  if (img) return <img src={img} alt={name} data-testid="avatar-img" className={clsx('h-8 w-8 shrink-0 rounded-full object-cover', className)} />;
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${(hue + 40) % 360} 70% 50%))` }}>
      {name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
    </span>
  );
};
