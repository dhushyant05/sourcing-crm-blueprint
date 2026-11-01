/**
 * Redis: pub/sub for live updates (SSE notifications, data-change events, session revocation),
 * shared counters for rate limiting, and a small cache. `MemoryBus` is the in-process stand-in for tests/dev.
 * All keys and channels use the `se:` prefix.
 */
import { Redis } from 'ioredis';

export type Handler = (msg: any) => void;
export interface Bus {
  publish(channel: string, msg: unknown): Promise<void>;
  subscribe(channel: string, f: Handler): void;
  /** Increments `key` and returns the new value; the key expires `ttlSec` after its first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

class Fanout {
  private subs = new Map<string, Set<Handler>>();
  add(ch: string, f: Handler) { let s = this.subs.get(ch); if (!s) this.subs.set(ch, (s = new Set())); s.add(f); }
  emit(ch: string, msg: unknown) { for (const f of this.subs.get(ch) ?? []) { try { f(msg); } catch { /* a broken listener never breaks the others */ } } }
  has(ch: string) { return !!this.subs.get(ch)?.size; }
}

export class MemoryBus implements Bus {
  private f = new Fanout();
  private kv = new Map<string, { v: string; exp: number }>();
  private live(k: string) { const e = this.kv.get(k); if (e && e.exp && e.exp < Date.now()) { this.kv.delete(k); return undefined; } return e; }
  async publish(ch: string, msg: unknown) { this.f.emit(ch, JSON.parse(JSON.stringify(msg))); }
  subscribe(ch: string, f: Handler) { this.f.add(ch, f); }
  async incr(k: string, ttl: number) { const e = this.live(k); const n = (e ? Number(e.v) : 0) + 1; this.kv.set(k, { v: String(n), exp: e?.exp || Date.now() + ttl * 1000 }); return n; }
  async get(k: string) { return this.live(k)?.v ?? null; }
  async set(k: string, v: string, ttl?: number) { this.kv.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }); }
  async del(k: string) { this.kv.delete(k); }
  async close() { /* nothing */ }
}

export class RedisBus implements Bus {
  private pub: Redis; private sub: Redis; private f = new Fanout();
  constructor(url: string) {
    const opts = { maxRetriesPerRequest: 3, lazyConnect: false, keyPrefix: undefined };
    this.pub = new Redis(url, opts); this.sub = new Redis(url, opts);
    for (const c of [this.pub, this.sub]) c.on('error', (e) => console.error('redis error', e.message));
    this.sub.on('message', (ch, raw) => { try { this.f.emit(ch, JSON.parse(raw)); } catch { /* ignore malformed */ } });
  }
  async publish(ch: string, msg: unknown) { await this.pub.publish(ch, JSON.stringify(msg)); }
  subscribe(ch: string, f: Handler) { if (!this.f.has(ch)) void this.sub.subscribe(ch); this.f.add(ch, f); }
  async incr(k: string, ttl: number) { const [[, n]] = (await this.pub.multi().incr(k).expire(k, ttl, 'NX').exec()) as [[unknown, number]]; return n; }
  async get(k: string) { return this.pub.get(k); }
  async set(k: string, v: string, ttl?: number) { if (ttl) await this.pub.set(k, v, 'EX', ttl); else await this.pub.set(k, v); }
  async del(k: string) { await this.pub.del(k); }
  async ping() { return this.pub.ping(); }
  async close() { this.sub.disconnect(); await this.pub.quit(); }
}
