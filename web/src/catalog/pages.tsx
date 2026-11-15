import { FavoriteButton } from './FavoriteButton';
import { useEffect, useState } from 'react';
import { Clock, Factory, FileText, GitCompare, Home, Lamp, MessageCircle, Package, Search, Share2, Shield, ShieldCheck, Shirt, Sparkles, Tag, TrendingUp, Truck, UtensilsCrossed, Warehouse, Wrench } from 'lucide-react';
import { publicCatalog } from './api';
import { CategoryExplorer } from './CategoryExplorer';
import { MarketplaceGreeting } from './GreetingStrip';
import { CompanySections } from './CompanySections';
import { EnquireForm } from './EnquireForm';
import { Gallery } from './Gallery';
import { ProductCard } from './ProductCard';
import { DEFAULT_TRUST } from './fixtures';
import { priceLabel, useCurrency } from './currency';
import { type Banner, type BannerSettings, type Breadcrumb, type Category, type Merchandising, type Product, type TrustItem } from './types';
import { breadcrumbOf, childrenOf, categoryBySlug, topLevel } from './tree';

const CAT_ICON: Record<string, typeof Factory> = {
  Hardware: Wrench, Housewares: Home, Kitchenware: UtensilsCrossed, Lighting: Lamp, Packaging: Package, Textiles: Shirt,
};

function go(path: string) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }

export function HomePage({ products, clearanceProducts = [], banners, settings, categories, trust }: {
  products: Product[]; clearanceProducts?: Product[]; banners: Banner[]; settings: BannerSettings; categories: Category[]; trust?: TrustItem[];
}) {
  const items = (trust && trust.length ? trust : DEFAULT_TRUST);
  const recommended = products.filter((p) => p.pinned).concat(products).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i).slice(0, 10);
  return (
    <>
      <MarketplaceGreeting />
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <h1 className="text-base font-semibold text-ink-800 sm:text-lg">Welcome to Source Easy</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            <QuickLink icon={FileText} label="Request for quotation" onClick={() => go('/#quote')} />
            <QuickLink icon={TrendingUp} label="Trending" onClick={() => go('/#recommended')} />
            {clearanceProducts.length > 0 && <QuickLink icon={Tag} label="Clearance" onClick={() => go('/#clearance')} />}
            <QuickLink icon={Sparkles} label="Custom sourcing" onClick={() => go('/#quote')} />
          </div>
        </div>
      </section>

      <CategoryExplorer categories={categories} products={products} banners={banners} settings={settings} icons={CAT_ICON} />

      <section id="recommended" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-ink-800">Recommended for your business</h2>
          <button type="button" onClick={() => go('/products')} className="text-sm font-medium text-brand-700 hover:underline">View all</button>
        </div>
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {recommended.map((p) => (
            <div key={p.id} className="w-36 shrink-0 sm:w-40"><ProductCard product={p} variant="compact" /></div>
          ))}
        </div>
      </section>

      {clearanceProducts.length > 0 && (
        <section id="clearance" className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-testid="clearance-section">
          <div className="flex items-end justify-between">
            <h2 className="text-lg font-semibold text-ink-800">Clearance</h2>
            <button type="button" onClick={() => go('/clearance')} className="text-sm font-medium text-brand-700 hover:underline">View all</button>
          </div>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {clearanceProducts.slice(0, 10).map((p) => (
              <div key={p.id} className="w-36 shrink-0 sm:w-40"><ProductCard product={p} variant="compact" /></div>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <h2 className="text-lg font-semibold text-ink-800">Products</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      <section className="mt-6 border-y border-ink-100 bg-warm-50/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {items.map((it, i) => {
            const Icon = [Factory, Warehouse, GitCompare, ShieldCheck][i % 4];
            return (
              <div key={it.title} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-soft"><Icon size={18} /></span>
                <div>
                  <h3 className="font-semibold text-ink-800">{it.title}</h3>
                  <p className="mt-0.5 text-sm text-ink-500">{it.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-warm-50">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">Need something that isn’t listed?</h2>
            <p className="mt-2 max-w-xl text-ink-600">Request a custom sourcing quote and the Source Easy team will come back to you with options, lead time and a price.</p>
          </div>
          <button type="button" onClick={() => go('/#quote')} className="rounded-full bg-warm-500 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-warm-600">
            Request a custom sourcing quote
          </button>
        </div>
      </section>
      <CompanySections />
    </>
  );
}

function QuickLink({ icon: Icon, label, onClick }: { icon: typeof Search; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 text-ink-700 hover:border-warm-300 hover:text-warm-600">
      <Icon size={14} className="text-warm-500" />{label}
    </button>
  );
}


export function ListingPage({ title, category, query, clearance = false, categories = [] }: { title: string; category?: string; query?: string; clearance?: boolean; categories?: Category[] }) {
  const [q, setQ] = useState(query ?? '');
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => { setQ(query ?? ''); }, [query]);
  useEffect(() => {
    let on = true; setBusy(true);
    publicCatalog.products({ q: q || undefined, category, limit: 48, sort: clearance ? undefined : 'trending', clearance: clearance ? 1 : undefined }).then((r) => { if (on) { setData(r.data); setTotal(r.total); } })
      .catch(() => { if (on) { setData([]); setTotal(0); } })
      .finally(() => { if (on) setBusy(false); });
    return () => { on = false; };
  }, [q, category, clearance]);
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const path = clearance ? `/clearance${q ? `?q=${encodeURIComponent(q)}` : ''}` : `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    history.replaceState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  const current = categoryBySlug(categories, category);
  const crumbs = current ? breadcrumbOf(categories, current) : [];
  const siblingParent = current?.parentId ?? null;
  const sidebarRoots = siblingParent ? childrenOf(categories, siblingParent) : topLevel(categories);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CatalogBreadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/products', label: 'Products' }, ...crumbs.map((c) => ({ href: `/c/${c.slug}`, label: c.name }))]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-800">{title}</h1>
      <form onSubmit={search} className="mt-6 max-w-xl">
        <input className="input rounded-full px-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this catalog" />
      </form>
      <p className="mt-3 text-sm text-ink-500">{busy ? 'Loading…' : `${total} product${total === 1 ? '' : 's'}`}</p>
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        {categories.length > 0 && (
          <aside className="rounded-2xl border border-ink-100 bg-white" aria-label="Categories">
            <div className="border-b border-ink-100 px-4 py-3 text-sm font-semibold text-ink-800">Categories</div>
            <button type="button" onClick={() => go('/products')}
              className={`block w-full px-4 py-2.5 text-left text-sm ${!category ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>All products</button>
            <CategoryTree items={sidebarRoots} all={categories} current={category} />
          </aside>
        )}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          {!busy && !data.length && <p className="mt-10 text-ink-500">No products match that search yet.</p>}
        </div>
      </div>
    </div>
  );
}

function CategoryTree({ items, all, current, depth = 0 }: { items: Category[]; all: Category[]; current?: string; depth?: number }) {
  return (
    <>
      {items.map((c) => {
        const kids = childrenOf(all, c.id);
        const on = current === c.slug;
        return (
          <div key={c.id}>
            <button type="button" onClick={() => go(`/c/${c.slug}`)}
              style={{ paddingLeft: `${16 + depth * 12}px` }}
              className={`block w-full py-2 pr-4 text-left text-sm ${on ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>{c.name}</button>
            {kids.length > 0 && <CategoryTree items={kids} all={all} current={current} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

function CatalogBreadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink-300">/</span>}
          {it.href && i < items.length - 1
            ? <button type="button" className="hover:text-brand-700" onClick={() => go(it.href!)}>{it.label}</button>
            : <span className="text-ink-700">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { currency } = useCurrency();
  const [p, setP] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [quoteKind, setQuoteKind] = useState<'SOURCING' | 'SHIPPING'>('SOURCING');
  const [qty, setQty] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  useEffect(() => {
    let on = true; setP(null); setErr(null); setChatOpen(false); setQuoteKind('SOURCING'); setSelected({});
    publicCatalog.product(slug).then((d) => {
      if (!on) return;
      setP(d);
      setQty(d.moq != null ? String(d.moq) : '1');
      const first: Record<string, string> = {};
      for (const v of d.merchandising?.variations ?? []) {
        if (v.options?.[0]?.label) first[v.name] = v.options[0].label;
      }
      setSelected(first);
      publicCatalog.related(d.slug).then((rows) => { if (on) setRelated(rows.slice(0, 8)); }).catch(() => undefined);
    }).catch((e) => { if (on) setErr((e as Error).message); });
    return () => { on = false; };
  }, [slug]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-500">This product is not available.</div>;
  if (!p) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-400">Loading…</div>;
  const m: Merchandising = p.merchandising ?? {};
  const specs = p.specs && typeof p.specs === 'object' ? Object.entries(p.specs).filter(([, v]) => v != null && String(v).trim()) : [];
  const industry = m.industryAttributes?.length ? m.industryAttributes : [];
  const other = m.otherAttributes?.length ? m.otherAttributes : (industry.length ? [] : specs.map(([key, value]) => ({ key, value: String(value) })));
  const tiers = p.tiers ?? [];
  const leadTimes = m.leadTimes ?? [];
  const customizations = m.customizations ?? [];
  const protections = m.protections ?? [];
  const packing = m.packing;
  const crumbs: Breadcrumb[] = p.breadcrumbs?.length ? p.breadcrumbs : (p.category?.slug && p.category.name ? [{ id: p.category.id || p.category.slug, slug: p.category.slug, name: p.category.name }] : []);
  const inquiryNote = Object.entries(selected).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setChatOpen(false);
  };
  const openEnquiry = (kind: 'SOURCING' | 'SHIPPING' = 'SOURCING') => {
    setQuoteKind(kind);
    scrollTo('quote');
  };
  const sections: [string, string][] = [
    ['attributes', 'Key attributes'],
    ['lead-time', 'Lead time'],
    ['customization', 'Customization'],
    ['packaging', 'Packaging & delivery'],
    ['description', 'Description'],
    ['protections', 'Source Easy protections'],
    ['reviews', 'Reviews'],
    ['quote', 'Send enquiry'],
  ];
  return (
    <div className="bg-white pb-28 lg:pb-8">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <CatalogBreadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/products', label: 'Products' }, ...crumbs.map((c) => ({ href: `/c/${c.slug}`, label: c.name })), { label: p.title }]} />

        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Gallery product={p} />
          <div>
            {p.isSample && <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Sample</span>}
            {p.clearance && <span data-testid="clearance-badge" className="ml-2 inline-flex rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Clearance</span>}
            {(p.pinned || p.trending) && <span className="ml-2 inline-flex rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warm-600">Trending</span>}
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">{p.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <FavoriteButton productId={p.id} />
                <a href={`https://wa.me/?text=${encodeURIComponent(`${p.title}\nhttps://sourceeasy.in/p/${p.slug}`)}`}
                  target="_blank" rel="noreferrer" data-testid="share-whatsapp"
                  className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 hover:border-brand-200 hover:text-brand-700">
                  <Share2 size={16} /> Share on WhatsApp
                </a>
              </div>
            </div>

            {p.clearance && p.clearancePrice && typeof p.clearancePrice === 'object' && p.clearancePrice.amounts ? (
              <div className="mt-4" data-testid="product-price">
                <p className="text-2xl font-semibold text-rose-700">
                  {priceLabel(p.clearancePrice, currency)}
                  {p.price?.amounts?.[currency]?.min != null && <span className="ml-3 text-lg font-normal text-ink-400 line-through">{priceLabel(p.price, currency)}</span>}
                </p>
                <p className="mt-1 text-sm text-rose-600">
                  {p.clearanceDiscountPct != null && <span className="font-semibold">{Math.round(p.clearanceDiscountPct)}% off</span>}
                  {p.clearanceStockLeft != null && <span>{p.clearanceDiscountPct != null ? ' · ' : ''}Only {p.clearanceStockLeft} left</span>}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-2xl font-semibold text-brand-700" data-testid="product-price">{priceLabel(p.price, currency)}</p>
            )}
            <p className="mt-1 text-sm text-ink-400">Sourced in China · Prices in USD, RMB and INR</p>

            {tiers.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-ink-100" data-testid="price-tiers">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-ink-500"><tr><th className="px-4 py-2">Quantity</th><th className="px-4 py-2">USD</th><th className="px-4 py-2">RMB</th><th className="px-4 py-2">INR</th></tr></thead>
                  <tbody>
                    {tiers.map((t, i) => (
                      <tr key={i} className="border-t border-ink-100">
                        <td className="px-4 py-2">{t.minQty}{t.maxQty ? `–${t.maxQty}` : '+'} {p.unit || 'pcs'}</td>
                        {(['USD', 'CNY', 'INR'] as const).map((cur) => (
                          <td key={cur} className={`px-4 py-2 font-medium ${cur === currency ? 'text-brand-700' : 'text-ink-800'}`}>
                            {t.amounts?.[cur] != null ? priceLabel({ mode: 'RANGE', base: cur, amounts: { USD: { min: t.amounts.USD ?? null, max: t.amounts.USD ?? null }, CNY: { min: t.amounts.CNY ?? null, max: t.amounts.CNY ?? null }, INR: { min: t.amounts.INR ?? null, max: t.amounts.INR ?? null } } } as any, cur) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(m.variations ?? []).length > 0 && (
              <div className="mt-5 space-y-4" data-testid="product-variations">
                {(m.variations ?? []).map((v) => (
                  <div key={v.name}>
                    <p className="text-sm font-medium text-ink-700">{v.name}{selected[v.name] ? <span className="font-normal text-ink-500"> · {selected[v.name]}</span> : null}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.options.map((o) => {
                        const on = selected[v.name] === o.label;
                        return (
                          <button key={o.label} type="button" onClick={() => setSelected((s) => ({ ...s, [v.name]: o.label }))}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-50 font-medium text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-200'}`}>
                            {o.hex && <span className="h-4 w-4 rounded-full border border-ink-200" style={{ backgroundColor: o.hex }} aria-hidden />}
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="text-sm text-ink-600">
                Quantity
                <span className="mt-1 flex items-center overflow-hidden rounded-full border border-ink-200">
                  <button type="button" className="px-3 py-2 text-ink-600" onClick={() => setQty(String(Math.max(p.moq ?? 1, (Number(qty) || 0) - 1)))} aria-label="Decrease quantity">−</button>
                  <input className="w-20 border-x border-ink-200 py-2 text-center text-ink-800" type="number" min={p.moq ?? 1} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="product-qty" />
                  <button type="button" className="px-3 py-2 text-ink-600" onClick={() => setQty(String((Number(qty) || 0) + 1))} aria-label="Increase quantity">+</button>
                </span>
              </label>
              {p.moq != null && <p className="pb-2 text-sm text-ink-500">Minimum order {p.moq} {p.unit || 'pcs'}</p>}
            </div>

            {customizations.length > 0 && (
              <div className="mt-5 rounded-2xl border border-ink-100 p-4" data-testid="buybox-customization">
                <p className="text-sm font-medium text-ink-700">Customization options</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {customizations.map((c) => (
                    <li key={c.label} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ink-800">{c.label}{c.note ? <span className="text-ink-500"> — {c.note}</span> : null}</span>
                      {c.moq != null && <span className="text-ink-500">Min. {c.moq} {p.unit || 'pcs'}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {m.samplePrice && (
              <div className="mt-4 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm" data-testid="sample-price">
                <p className="font-medium text-ink-800">Sample</p>
                <p className="mt-1 text-ink-700">
                  {m.samplePrice.currency} {Number(m.samplePrice.amount).toFixed(2)}
                  {m.samplePrice.leadTime ? ` · ${m.samplePrice.leadTime}` : ''}
                </p>
                {p.samplePolicy && <p className="mt-1 text-ink-500">{p.samplePolicy}</p>}
              </div>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              {p.moq != null && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Minimum order</dt><dd className="font-medium text-ink-800">{p.moq} {p.unit || 'pcs'}</dd></div>}
              {p.capacity && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Supply capacity</dt><dd className="font-medium text-ink-800">{p.capacity}</dd></div>}
              {p.leadTime && !leadTimes.length && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Lead time</dt><dd className="font-medium text-ink-800">{p.leadTime}</dd></div>}
            </dl>

            {leadTimes.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-ink-100" data-testid="lead-time-table">
                <div className="flex items-center gap-2 bg-ink-50 px-4 py-2 text-sm font-medium text-ink-600"><Clock size={14} /> Lead time by quantity</div>
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-500"><tr><th className="px-4 py-2">Quantity</th><th className="px-4 py-2">Estimated lead time</th></tr></thead>
                  <tbody>
                    {leadTimes.map((t, i) => (
                      <tr key={i} className="border-t border-ink-100">
                        <td className="px-4 py-2">{t.minQty}{t.maxQty ? `–${t.maxQty}` : '+'} {p.unit || 'pcs'}</td>
                        <td className="px-4 py-2 font-medium text-ink-800">{t.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-ink-100 p-4" data-testid="shipping-estimate">
              <div className="flex items-center gap-2 text-sm font-medium text-ink-700"><Truck size={16} className="text-brand-700" /> Shipping and delivery</div>
              <dl className="mt-2 space-y-1 text-sm">
                {m.shipping?.origin && <div className="flex gap-2"><dt className="text-ink-500">Ships from</dt><dd className="font-medium text-ink-800">{m.shipping.origin}</dd></div>}
                {m.shipping?.estimate && <div className="flex gap-2"><dt className="text-ink-500">Typical transit</dt><dd className="font-medium text-ink-800">{m.shipping.estimate}</dd></div>}
              </dl>
              <p className="mt-2 text-sm text-ink-500">{m.shipping?.note || 'Freight is quoted by the Source Easy team. This page does not calculate a live shipping rate.'}</p>
              <button type="button" className="mt-3 text-sm font-medium text-brand-700 hover:underline" onClick={() => openEnquiry('SHIPPING')}>Request a shipping quote</button>
            </div>

            {protections.length > 0 && (
              <div className="mt-5 rounded-2xl border border-ink-100 bg-warm-50/50 p-4" data-testid="protections-preview">
                <div className="flex items-center gap-2 text-sm font-medium text-ink-700"><Shield size={16} className="text-brand-700" /> Source Easy protections</div>
                <ul className="mt-2 space-y-1 text-sm text-ink-600">
                  {protections.slice(0, 4).map((x) => <li key={x.title}>{x.title}</li>)}
                </ul>
                <button type="button" className="mt-2 text-sm font-medium text-brand-700 hover:underline" onClick={() => scrollTo('protections')}>See details</button>
              </div>
            )}

            {(industry.length > 0 || other.length > 0) && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-ink-100">
                <div className="bg-ink-50 px-4 py-2 text-sm font-medium text-ink-600">Key attributes</div>
                <table className="w-full text-sm">
                  <tbody>
                    {(industry.length ? industry : other).slice(0, 6).map((row) => (
                      <tr key={row.key} className="border-t border-ink-100">
                        <th className="w-40 px-4 py-2 text-left font-medium capitalize text-ink-500">{row.key}</th>
                        <td className="px-4 py-2 text-ink-700">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="relative mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => openEnquiry('SOURCING')} data-testid="send-enquiry"
                className="rounded-full bg-warm-500 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-warm-600">
                Send enquiry
              </button>
              <button type="button" data-testid="product-chat" onClick={() => setChatOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-5 py-2.5 text-sm font-semibold text-ink-800 hover:border-brand-200 hover:text-brand-700">
                <MessageCircle size={16} /> Chat
              </button>
              {chatOpen && (
                <div data-testid="product-chat-panel" className="absolute left-0 top-full z-10 mt-2 w-80 rounded-2xl border border-ink-100 bg-white p-4 text-sm shadow-soft">
                  <p className="font-medium text-ink-800">Chat with Source Easy</p>
                  <p className="mt-1 text-ink-500">Use the send-enquiry form on this product and the Source Easy team will reply.</p>
                  <button type="button" className="mt-3 text-sm font-medium text-brand-700 hover:underline" onClick={() => openEnquiry('SOURCING')}>Open enquiry form</button>
                </div>
              )}
            </div>

            <SupplierCard product={p} />
          </div>
        </div>

        <div className="mt-12 sticky top-16 z-20 -mx-4 overflow-x-auto border-y border-ink-100 bg-white px-4 sm:-mx-6 sm:px-6" role="tablist">
          <div className="flex min-w-max gap-1">
            {sections.map(([id, label]) => (
              <button key={id} type="button" onClick={() => scrollTo(id)}
                className="px-4 py-3 text-sm font-medium text-ink-600 hover:text-brand-700">{label}</button>
            ))}
          </div>
        </div>

        <section id="attributes" className="scroll-mt-36 border-b border-ink-100 py-8">
          <h2 className="text-xl font-semibold text-ink-800">Key attributes</h2>
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <AttributeTable title="Industry-specific attributes" rows={industry} empty="No industry-specific attributes have been added yet." />
            <AttributeTable title="Other attributes" rows={other} empty="No other attributes have been added yet." />
          </div>
        </section>

        <section id="lead-time" className="scroll-mt-36 border-b border-ink-100 py-8">
          <h2 className="text-xl font-semibold text-ink-800">Lead time</h2>
          {leadTimes.length ? (
            <table className="mt-4 w-full max-w-xl text-sm">
              <thead className="text-left text-ink-500"><tr><th className="py-2 pr-4">Quantity ({p.unit || 'pcs'})</th><th className="py-2">Estimated lead time</th></tr></thead>
              <tbody>
                {leadTimes.map((t, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    <td className="py-2 pr-4">{t.minQty}{t.maxQty ? `–${t.maxQty}` : '+'}</td>
                    <td className="py-2 font-medium text-ink-800">{t.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mt-3 text-ink-500">{p.leadTime ? `Typical lead time: ${p.leadTime}` : 'Lead time will be confirmed with your quote.'}</p>}
        </section>

        <section id="customization" className="scroll-mt-36 border-b border-ink-100 py-8">
          <h2 className="text-xl font-semibold text-ink-800">Customization</h2>
          {customizations.length ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-ink-100">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-ink-500"><tr><th className="px-4 py-2">Option</th><th className="px-4 py-2">Minimum order</th><th className="px-4 py-2">Notes</th></tr></thead>
                <tbody>
                  {customizations.map((c) => (
                    <tr key={c.label} className="border-t border-ink-100">
                      <td className="px-4 py-2 font-medium text-ink-800">{c.label}</td>
                      <td className="px-4 py-2">{c.moq != null ? `${c.moq} ${p.unit || 'pcs'}` : 'On request'}</td>
                      <td className="px-4 py-2 text-ink-600">{c.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-4 max-w-3xl whitespace-pre-line text-ink-600">{p.customization || (!customizations.length ? 'Ask about logos, colours, packing and other custom options in your enquiry.' : '')}</p>
        </section>

        <section id="packaging" className="scroll-mt-36 border-b border-ink-100 py-8">
          <h2 className="text-xl font-semibold text-ink-800">Packaging & delivery</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {packing?.sellingUnits && <PackFact label="Selling units" value={packing.sellingUnits} />}
            {packing?.singlePackageSize && <PackFact label="Single package size" value={packing.singlePackageSize} />}
            {packing?.grossWeight && <PackFact label="Single gross weight" value={packing.grossWeight} />}
            {packing?.packageType && <PackFact label="Package type" value={packing.packageType} />}
          </dl>
          <p className="mt-4 max-w-3xl whitespace-pre-line leading-relaxed text-ink-700">{p.packaging || (!packing ? 'Packaging and delivery details will be confirmed with your quote.' : '')}</p>
        </section>

        <section id="description" className="scroll-mt-36 border-b border-ink-100 py-8" data-testid="product-description">
          <h2 className="text-xl font-semibold text-ink-800">Product description</h2>
          <div className="mt-4 max-w-3xl whitespace-pre-line leading-relaxed text-ink-700">{m.description || p.summary || 'No description has been added for this product yet.'}</div>
          {p.images.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {p.images.map((im) => (
                <img key={im.id} src={im.url} alt={im.altText || p.title} className="w-full rounded-2xl border border-ink-100 object-cover" />
              ))}
            </div>
          )}
        </section>

        <section id="protections" className="scroll-mt-36 border-b border-ink-100 py-8" data-testid="protections">
          <h2 className="text-xl font-semibold text-ink-800">Source Easy protections</h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-500">These are Source Easy’s own guarantees for catalog enquiries. They are not Alibaba Trade Assurance or any third-party escrow.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {protections.map((x) => (
              <div key={x.title} className="rounded-2xl border border-ink-100 bg-ink-50 p-4">
                <div className="flex items-center gap-2 font-medium text-ink-800"><ShieldCheck size={16} className="text-brand-700" />{x.title}</div>
                <p className="mt-2 text-sm text-ink-600">{x.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="reviews" className="scroll-mt-36 border-b border-ink-100 py-8" data-testid="reviews-placeholder">
          <h2 className="text-xl font-semibold text-ink-800">Reviews</h2>
          <p className="mt-3 max-w-3xl text-ink-600">{m.reviewsNote || 'Buyer reviews will appear here after Source Easy customers share feedback on this product. There are no reviews yet.'}</p>
        </section>

        <div id="quote" className="mt-8 scroll-mt-56 rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-ink-800">Send enquiry</h2>
          <p className="mt-1 text-sm text-ink-500">This enquiry is for {p.title}. We’ll come back with a Source Easy quote. This is not a checkout.</p>
          <div className="mt-4"><EnquireForm product={p} defaultQty={qty} inquiryNote={inquiryNote} defaultKind={quoteKind} /></div>
        </div>

        {related.length > 0 && (
          <section className="mt-16" data-testid="related-products">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-800">Related products</h2>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {related.map((r) => <ProductCard key={r.id} product={r} />)}
            </div>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white/95 px-4 py-3 shadow-soft backdrop-blur lg:hidden" data-testid="mobile-sticky-bar" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-brand-700">{priceLabel(p.price, currency)}</p>
            {p.moq != null && <p className="text-xs text-ink-500">MOQ {p.moq} {p.unit || 'pcs'}</p>}
          </div>
          <button type="button" onClick={() => setChatOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-2 text-sm font-semibold text-ink-800">
            <MessageCircle size={16} /> Chat
          </button>
          <button type="button" onClick={() => openEnquiry('SOURCING')} className="rounded-full bg-warm-500 px-4 py-2 text-sm font-semibold text-white">
            Send enquiry
          </button>
        </div>
      </div>
    </div>
  );
}

function AttributeTable({ title, rows, empty }: { title: string; rows: { key: string; value: string }[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink-600">{title}</h3>
      {rows.length ? (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-ink-100">
                <th className="w-48 py-2 pr-4 text-left font-medium capitalize text-ink-500">{row.key}</th>
                <td className="py-2 text-ink-700">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-2 text-sm text-ink-500">{empty}</p>}
    </div>
  );
}

function PackFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function SupplierCard({ product }: { product: Product }) {
  const s = product.supplier;
  if (s) {
    return (
      <div data-testid="supplier-card" className="mt-8 rounded-2xl border border-ink-100 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Supplier</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-ink-800">{s.company}</h2>
          {s.verified && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Verified</span>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {s.region && <div><dt className="text-ink-500">Location</dt><dd className="font-medium text-ink-800">{s.region}</dd></div>}
          {s.years != null && <div><dt className="text-ink-500">Years in business</dt><dd className="font-medium text-ink-800">{s.years}</dd></div>}
        </dl>
        {s.about && <p className="mt-3 text-sm text-ink-600">{s.about}</p>}
      </div>
    );
  }
  if (product.supplierAvailable) {
    return (
      <div data-testid="supplier-members-only" className="mt-8 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-600">
        Supplier details are visible to Source Easy members.{' '}
        <a href="/portal" className="font-medium text-brand-700 hover:underline">Sign in to the customer portal</a>
      </div>
    );
  }
  return null;
}
