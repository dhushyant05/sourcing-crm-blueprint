import type { Banner, BannerSettings, CatalogStatus, Category, Product } from './types';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json() as Promise<T>;
}

export const publicCatalog = {
  status: () => get<CatalogStatus>('/api/public/catalog/status'),
  categories: () => get<{ data: Category[] }>('/api/public/catalog/categories').then((r) => r.data),
  products: (q: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return get<{ data: Product[]; total: number; limit: number; offset: number }>(`/api/public/catalog/products${s ? `?${s}` : ''}`);
  },
  product: (slug: string) => get<{ data: Product }>(`/api/public/catalog/products/${encodeURIComponent(slug)}`).then((r) => r.data),
  banners: () => get<{ data: Banner[] } & BannerSettings>('/api/public/catalog/banners'),
  enquire: async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/public/catalog/products/${encodeURIComponent(id)}/enquire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Could not send enquiry'), { code: j.code });
    return j as { ok: true; reference: string; loginRequested?: boolean };
  },
};

export function staffToken() { return sessionStorage.getItem('se.jwt'); }

export async function staffReq<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = staffToken();
  const fd = body instanceof FormData;
  const r = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !fd ? { 'content-type': 'application/json' } : {}) },
    body: fd ? body as FormData : body != null ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, code: j.code });
  return j as T;
}
