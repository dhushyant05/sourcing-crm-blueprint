import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DemoApi, TwentyApi, type Api } from './api';
import { perms, type Role } from './roles';

export interface Session { name: string; email: string; role: Role; demo: boolean }
interface Ctx { session: Session | null; api: Api; perms: ReturnType<typeof perms>; signIn(s: Session, url?: string, token?: string): void; signOut(): void; setRole(r: Role): void }

const C = createContext<Ctx>(null!);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => JSON.parse(sessionStorage.getItem('se.session') ?? 'null'));
  const [api, setApi] = useState<Api>(() => {
    const url = sessionStorage.getItem('se.url'), tok = sessionStorage.getItem('se.token');
    return url && tok ? new TwentyApi(url, tok) : new DemoApi();
  });
  useEffect(() => { sessionStorage.setItem('se.session', JSON.stringify(session)); }, [session]);
  const signIn = useCallback((s: Session, url?: string, token?: string) => {
    // Token kept in sessionStorage only (cleared when the tab closes); never persisted to disk.
    if (url && token) { sessionStorage.setItem('se.url', url); sessionStorage.setItem('se.token', token); setApi(new TwentyApi(url, token)); }
    else setApi(new DemoApi());
    setSession(s);
  }, []);
  const signOut = useCallback(() => { sessionStorage.clear(); setSession(null); }, []);
  const setRole = useCallback((role: Role) => setSession((s) => (s ? { ...s, role } : s)), []);
  return <C.Provider value={{ session, api, perms: perms(session?.role ?? 'INDIA_STAFF'), signIn, signOut, setRole }}>{children}</C.Provider>;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    fn().then((d) => live && setData(d), (e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
