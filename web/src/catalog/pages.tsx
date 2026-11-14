import { useEffect, useState } from 'react';
import { publicCatalog } from './api';
import { BannerCarousel } from './Banner';
import { CompanySections } from './CompanySections';
import { EnquireForm } from './EnquireForm';
import { ProductCard } from './ProductCard';
import { priceLabel, useCurrency } from './currency';
import type { Banner, BannerSettings, Category, Product } from './types';

export function HomePage({ products, banners, settings, categories }: { products: Product[]; banners: Banner[]; settings: BannerSettings; categories: Category[] }) {
  const trending = products.filter((p) => p.pinned).concat(products).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i).slice(0, 8);
  const go = (path: string) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <>
      <BannerCarousel banners={banners} settings={settings} />
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Catalog</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">Trending products</h1>
          </div>
          <button type="button" onClick={() => go('/products')} className="text-sm font-medium text-brand-700 hover:underline">View all</button>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6">
          {trending.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>
      <section className="border-y border-ink-100 bg-ink-50/70">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Categories</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => go(`/c/${c.slug}`)}
                className="rounded-2xl border border-ink-100 bg-white px-4 py-6 text-sm font-semibold text-ink-800 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </section>
      <CompanySections />
    </>
  );
}

export function ListingPage({ title, category, query }: { title: string; category?: string; query?: string }) {
  const [q, setQ] = useState(query ?? '');
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => { setQ(query ?? ''); }, [query]);
  useEffect(() => {
    let on = true; setBusy(true);
    publicCatalog.products({ q: q || undefined, category, limit: 48, sort: 'trending' }).then((r) => { if (on) { setData(r.data); setTotal(r.total); } })
      .catch(() => { if (on) { setData([]); setTotal(0); } })
      .finally(() => { if (on) setBusy(false); });
    return () => { on = false; };
  }, [q, category]);
  const search = (e: React.FormEvent) => { e.preventDefault(); history.replaceState({}, '', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`); dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-900">{title}</h1>
      <form onSubmit={search} className="mt-6 max-w-xl">
        <input className="input rounded-full px-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this catalog" />
      </form>
      <p className="mt-3 text-sm text-ink-500">{busy ? 'Loading…' : `${total} product${total === 1 ? '' : 's'}`}</p>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6">
        {data.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      {!busy && !data.length && <p className="mt-10 text-ink-500">No products match that search yet.</p>}
    </div>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { currency } = useCurrency();
  const [p, setP] = useState<Product | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [img, setImg] = useState(0);
  useEffect(() => {
    let on = true; setP(null); setErr(null);
    publicCatalog.product(slug).then((d) => { if (on) setP(d); }).catch((e) => { if (on) setErr((e as Error).message); });
    return () => { on = false; };
  }, [slug]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-500">This product is not available.</div>;
  if (!p) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-400">Loading…</div>;
  const photos = p.images.length ? p.images : [];
  const cur = photos[img] ?? photos[0];
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500"><a href="/products" className="hover:text-brand-700" onClick={(e) => { e.preventDefault(); history.pushState({}, '', '/products'); dispatchEvent(new PopStateEvent('popstate')); }}>Products</a>
        {p.category?.name && <> / {p.category.name}</>}</p>
      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-50 shadow-soft">
            {cur && <img src={cur.url} alt={cur.altText || p.title} className="aspect-square w-full object-cover" />}
          </div>
          {photos.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {photos.map((ph, i) => (
                <button key={ph.id} type="button" onClick={() => setImg(i)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border ${i === img ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-200'}`}>
                  <img src={ph.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          {p.isSample && <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Sample</span>}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{p.title}</h1>
          <p className="mt-3 text-2xl font-semibold text-brand-700">{priceLabel(p.price, currency)}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {p.moq != null && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Minimum order</dt><dd className="font-medium text-ink-900">{p.moq} {p.unit || 'pcs'}</dd></div>}
            {p.leadTime && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Lead time</dt><dd className="font-medium text-ink-900">{p.leadTime}</dd></div>}
          </dl>
          {p.summary && <p className="mt-6 leading-relaxed text-ink-600">{p.summary}</p>}
          <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
            <h2 className="font-semibold text-ink-900">Request a quote</h2>
            <p className="mt-1 text-sm text-ink-500">We’ll come back with a Source Easy quote. This is not a checkout.</p>
            <div className="mt-4"><EnquireForm product={p} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
