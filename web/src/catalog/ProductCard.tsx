import { useCurrency, priceLabel } from './currency';
import type { Product } from './types';

export function ProductCard({ product }: { product: Product }) {
  const { currency } = useCurrency();
  const img = product.images.find((i) => i.kind === 'CARD') ?? product.images[0];
  const open = (e: React.MouseEvent) => { e.preventDefault(); history.pushState({}, '', `/p/${product.slug}`); dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <a href={`/p/${product.slug}`} onClick={open} data-testid={`product-${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      <div className="relative aspect-square overflow-hidden bg-ink-50">
        {img ? <img src={img.url} alt={img.altText || product.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="h-full w-full bg-ink-100" />}
        {product.isSample && <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 shadow-sm">Sample</span>}
        {product.pinned && !product.isSample && <span className="absolute left-3 top-3 rounded-full bg-accent-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">Trending</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{product.category?.name}</p>
        <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold text-ink-900">{product.title}</h3>
        <p className="mt-2 text-sm font-semibold text-brand-700">{priceLabel(product.price, currency)}</p>
        {product.moq != null && <p className="mt-1 text-xs text-ink-500">MOQ {product.moq} {product.unit || 'pcs'}</p>}
      </div>
    </a>
  );
}
