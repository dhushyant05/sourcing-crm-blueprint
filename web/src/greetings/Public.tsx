import { useCallback } from 'react';
import { GreetingBanner, useGreeting, type Greeting } from './Banner';

/** Public website banner (PUBLIC surface; drafts and expired greetings never reach this feed). */
export function PublicGreeting() {
  const load = useCallback(async () => { const r = await fetch('/api/public/greetings'); if (!r.ok) return []; return ((await r.json()).data ?? []) as Greeting[]; }, []);
  const { greeting, close } = useGreeting('se.greet.public', load);
  if (!greeting) return null;
  return <div className="relative mx-auto mb-10 max-w-6xl px-4 sm:px-6"><GreetingBanner g={greeting} onClose={close} /></div>;
}
