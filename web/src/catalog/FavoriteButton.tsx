import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { portalToken } from '../portal/api';
import { ProductCard } from './ProductCard';
import type { Product } from './types';

async function fav(method: string, path: string) {
  const t = portalToken.get();
  if (!t) return { ok: false as const, login: true as const };
  const r = await fetch(path, { method, headers: { authorization: `Bearer ${t}` } });
  if (r.status === 401) return { ok: false as const, login: true as const };
  return { ok: r.ok, login: false as const, data: r.ok ? await r.json().catch(() => ({})) : undefined };
}

export function FavoriteButton({ productId, className = '' }: { productId: string; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    if (!portalToken.get()) return;
    void fav('GET', '/api/portal/catalog/favorites/ids').then((r) => {
      if (live && r.ok) setOn(((r.data as { data?: string[] })?.data ?? []).includes(productId));
    });
    return () => { live = false; };
  }, [productId]);
  const toggle = async () => {
    if (!portalToken.get()) { location.href = '/portal'; return; }
    const path = `/api/portal/catalog/favorites/${encodeURIComponent(productId)}`;
    const r = await fav(on ? 'DELETE' : 'PUT', path);
    if (r.login) { location.href = '/portal'; return; }
    if (r.ok) setOn(!on);
  };
  return (
    <button type="button" onClick={() => void toggle()} aria-pressed={on}
      aria-label={on ? 'Remove from saved favourites' : 'Save to favourites'}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${on ? 'border-warm-200 bg-warm-50 text-warm-600' : 'border-ink-200 bg-white text-ink-600 hover:border-warm-200 hover:text-warm-600'} ${className}`}>
      <Heart size={16} className={on ? 'fill-warm-500 text-warm-500' : ''} />
      {on ? 'Saved' : 'Save'}
    </button>
  );
}

export function FavoritesPage() {
  const [items, setItems] = useState<Product[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  useEffect(() => {
    if (!portalToken.get()) { setNeedLogin(true); setItems([]); return; }
    void fav('GET', '/api/portal/catalog/favorites').then((r) => {
      if (r.login) { setNeedLogin(true); setItems([]); return; }
      setItems(((r.data as { data?: Product[] })?.data ?? []));
    });
  }, []);
  if (needLogin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-semibold text-ink-800">Saved favourites</h1>
        <p className="mt-3 text-ink-500">Sign in to the Customer Portal to save products and come back to them later.</p>
        <a href="/portal" className="mt-6 inline-flex rounded-lg bg-warm-500 px-4 py-2 text-sm font-semibold text-white hover:bg-warm-600">Customer Portal login</a>
      </div>
    );
  }
  if (!items) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-400">Loading…</div>;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-800">Saved favourites</h1>
      {items.length === 0
        ? <p className="mt-6 text-ink-500">You have not saved any products yet. Open a product and tap Save.</p>
        : <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
    </div>
  );
}
