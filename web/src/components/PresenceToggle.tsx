import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

type State = { state: 'available' | 'away' | 'offline'; away: 'manual' | 'auto' | null; counts: boolean };
const IDLE_KEY = 'se.presence.idleMin';
const BEAT_MS = 45_000;
const IDLE_CHOICES = [0, 5, 15, 30];

const idleMinutes = () => {
  const v = Number(localStorage.getItem(IDLE_KEY));
  return Number.isFinite(v) && IDLE_CHOICES.includes(v) && localStorage.getItem(IDLE_KEY) !== null ? v : 15;
};

/**
 * Keeps the customer support desk presence fresh while the staff web app is open (the live stream already marks the user
 * connected; this adds idle detection → auto-away) and exposes the Available/Away switch for the chat header.
 */
export function usePresence(enabled: boolean) {
  const { api } = useApp();
  const [st, setSt] = useState<State | null>(null);
  const last = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !api.chatPresenceBeat) return;
    const bump = () => { last.current = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'visibilitychange'] as const;
    for (const e of evs) window.addEventListener(e, bump, { passive: true });
    const beat = async () => {
      const idle = idleMinutes();
      const active = idle === 0 || Date.now() - last.current < idle * 60_000;
      try { setSt(await api.chatPresenceBeat!(active)); } catch { /* offline: server TTL handles it */ }
    };
    void beat();
    const t = setInterval(() => void beat(), BEAT_MS);
    return () => { clearInterval(t); for (const e of evs) window.removeEventListener(e, bump); };
  }, [api, enabled]);

  const set = useCallback(async (status: 'available' | 'away') => {
    if (!api.setChatPresence) return;
    last.current = Date.now();
    try { setSt(await api.setChatPresence(status)); } catch { /* keep */ }
  }, [api]);

  return { st, set };
}

export function PresenceToggle({ st, set }: { st: State | null; set: (s: 'available' | 'away') => Promise<void> }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [idle, setIdle] = useState(idleMinutes());
  if (!st || !st.counts) return null;
  const away = st.state === 'away';
  return (
    <div className="relative">
      <button type="button" data-testid="presence-toggle" aria-haspopup="menu" aria-expanded={menu}
        className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs" onClick={() => setMenu((v) => !v)}>
        <span className={`inline-block h-2 w-2 rounded-full ${away ? 'bg-ink-300' : 'bg-emerald-500'}`} />
        {away ? t('chat.away') : t('chat.available')}
        <ChevronDown size={12} />
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-ink-200 bg-white p-2 text-xs shadow-lift dark:border-ink-700 dark:bg-ink-900">
          {(['available', 'away'] as const).map((s) => (
            <button key={s} type="button" role="menuitemradio" aria-checked={(s === 'away') === away} data-testid={`presence-${s}`}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-ink-50 dark:hover:bg-ink-800"
              onClick={() => { void set(s); setMenu(false); }}>
              <span className={`inline-block h-2 w-2 rounded-full ${s === 'away' ? 'bg-ink-300' : 'bg-emerald-500'}`} />
              {s === 'away' ? t('chat.away') : t('chat.available')}
              {(s === 'away') === away && <span className="ml-auto text-brand-700">✓</span>}
            </button>
          ))}
          <label className="mt-1 flex items-center justify-between gap-2 border-t border-ink-100 px-2 pt-2 dark:border-ink-800">
            <span>{t('chat.autoAway')}</span>
            <select className="input !w-auto !py-0.5 text-xs" value={idle} data-testid="presence-idle"
              onChange={(e) => { const v = Number(e.target.value); localStorage.setItem(IDLE_KEY, String(v)); setIdle(v); }}>
              {IDLE_CHOICES.map((m) => <option key={m} value={m}>{m === 0 ? t('chat.autoAwayOff') : t('chat.autoAwayMin', { n: m })}</option>)}
            </select>
          </label>
          <p className="mt-2 px-2 text-[11px] leading-snug text-ink-500">{t('chat.presenceHint')}</p>
        </div>
      )}
    </div>
  );
}
