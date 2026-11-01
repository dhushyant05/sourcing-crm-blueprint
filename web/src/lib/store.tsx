import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DemoApi, ServerApi, type Api, type Me } from './api';
import { perms, type Role } from './roles';
import { deviceLang, LANGS, setLang, type Lang } from '../i18n';

export interface Session { name: string; email: string; role: Role; demo: boolean }
interface Ctx { session: Session | null; api: Api; perms: ReturnType<typeof perms>; signIn(s: Session, token?: string): void; signOut(): void; setRole(r: Role): void }

const C = createContext<Ctx>(null!);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => JSON.parse(sessionStorage.getItem('se.session') ?? 'null'));
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('se.jwt'));
  useEffect(() => { sessionStorage.setItem('se.session', JSON.stringify(session)); }, [session]);
  const signOut = useCallback(() => { sessionStorage.clear(); setToken(null); setSession(null); }, []);
  // Only a short-lived session JWT from our server is kept (sessionStorage, cleared with the tab). No Twenty credentials.
  const signIn = useCallback((s: Session, t?: string) => {
    if (t) { sessionStorage.setItem('se.jwt', t); setToken(t); } else { sessionStorage.removeItem('se.jwt'); setToken(null); }
    setSession(s);
  }, []);
  const api = useMemo<Api>(() => (session && !session.demo && token ? new ServerApi(token, session.role, signOut) : new DemoApi()),
    [session?.demo, session?.role, token, signOut]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh role/name from the server on reload (role changes by an admin take effect without re-login).
  useEffect(() => {
    if (!token || session?.demo) return;
    fetch('/api/me', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.status === 401 ? (signOut(), null) : r.json()))
      .then((me: Me | null) => {
        if (!me?.role) return;
        setSession((s) => (s ? { ...s, name: me.name, email: me.email, role: me.role } : s));
        // Device choice wins; otherwise adopt the language saved on the account.
        if (!deviceLang() && LANGS.includes(me.language as Lang)) setLang(me.language as Lang);
      })
      .catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // Role switching is a demo-only preview; live roles come from the server.
  const setRole = useCallback((role: Role) => setSession((s) => (s?.demo ? { ...s, role } : s)), []);
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
