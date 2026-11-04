import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DemoApi, ServerApi, type Api, type Me } from './api';
import { perms, type Role } from './roles';
import { deviceLang, LANGS, setLang, type Lang } from '../i18n';

export interface Session { id?: string; name: string; email: string; role: Role; demo: boolean; avatarUrl?: string | null; permissions?: string[] }
interface Ctx { session: Session | null; api: Api; perms: ReturnType<typeof perms>; signIn(s: Session, token?: string): void; signOut(): void; setRole(r: Role): void;
  /** Staff name → picture URL (for avatars next to names). */ people: Record<string, string>; refreshPeople(): void;
  updateSession(p: Partial<Session>): void; replaceToken(t: string): void }

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
  const [meTick, setMeTick] = useState(0);
  // Permission changes are pushed live (SSE `change` of type `perms`): refetch /api/me so the UI updates instantly.
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.type === 'perms') setMeTick((n) => n + 1); };
    addEventListener('se:data', h); return () => removeEventListener('se:data', h);
  }, []);
  useEffect(() => {
    if (!token || session?.demo) return;
    fetch('/api/me', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.status === 401 ? (signOut(), null) : r.json()))
      .then((me: Me | null) => {
        if (!me?.role) return;
        setSession((s) => (s ? { ...s, id: me.id, name: me.name, email: me.email, role: me.role, avatarUrl: me.avatarUrl ?? null, permissions: me.permissions } : s));
        // Device choice wins; otherwise adopt the language saved on the account.
        if (!deviceLang() && LANGS.includes(me.language as Lang)) setLang(me.language as Lang);
      })
      .catch(() => {});
  }, [token, meTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Role switching is a demo-only preview; live roles come from the server.
  const setRole = useCallback((role: Role) => setSession((s) => (s?.demo ? { ...s, role } : s)), []);
  const [people, setPeople] = useState<Record<string, string>>({}), [pTick, setPTick] = useState(0);
  useEffect(() => {
    if (!token || session?.demo) { setPeople({}); return; }
    fetch('/api/people', { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data: { name: string; avatarUrl: string | null }[] }) => setPeople(Object.fromEntries(j.data.filter((p) => p.avatarUrl).map((p) => [p.name, p.avatarUrl!]))))
      .catch(() => {});
  }, [token, pTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshPeople = useCallback(() => setPTick((n) => n + 1), []);
  const updateSession = useCallback((p: Partial<Session>) => setSession((s) => (s ? { ...s, ...p } : s)), []);
  const replaceToken = useCallback((t: string) => { sessionStorage.setItem('se.jwt', t); setToken(t); }, []);
  return <C.Provider value={{ session, api, perms: perms(session?.role ?? 'INDIA_STAFF', session?.demo ? null : session?.permissions), signIn, signOut, setRole, people, refreshPeople, updateSession, replaceToken }}>{children}</C.Provider>;
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
  // Live data: silently refetch (no spinner/flicker) when the server says something changed.
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null, live = true;
    const h = () => { if (t) clearTimeout(t); t = setTimeout(() => { fnRef.current().then((d) => live && setData(d), () => {}); }, 300); };
    addEventListener('se:data', h);
    return () => { live = false; if (t) clearTimeout(t); removeEventListener('se:data', h); };
  }, []);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
