import { useCallback, useEffect, useState } from 'react';
import { GreetingBanner, isCurrent, type Greeting } from '../greetings/Banner';

const KEY = 'se.greet.market.session';

function closedIds(): string[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function isClosed(g: Greeting) { return closedIds().includes(`${g.id}:${g.version}`); }
function closeGreeting(g: Greeting) {
  sessionStorage.setItem(KEY, JSON.stringify([...closedIds().filter((k) => !k.startsWith(`${g.id}:`)), `${g.id}:${g.version}`].slice(-20)));
}

/** Festival / event greeting on the marketplace homepage only. Not mixed into the product banner carousel. Close hides it for this browser session. */
export function MarketplaceGreeting() {
  const load = useCallback(async () => {
    const r = await fetch('/api/public/greetings');
    if (!r.ok) return [];
    return ((await r.json()).data ?? []) as Greeting[];
  }, []);
  const [list, setList] = useState<Greeting[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => { if (live) setList(d); }).catch(() => undefined);
    const t = setInterval(() => bump((n) => n + 1), 60e3);
    return () => { live = false; clearInterval(t); };
  }, [load]);
  const greeting = list.filter((x) => isCurrent(x) && !isClosed(x)).sort((a, b) => b.priority - a.priority)[0] ?? null;
  if (!greeting) return null;
  return (
    <section className="border-b border-ink-100 bg-white" aria-label="Festival greeting">
      <div className="relative mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <GreetingBanner g={greeting} onClose={() => { closeGreeting(greeting); bump((n) => n + 1); }} />
      </div>
    </section>
  );
}
