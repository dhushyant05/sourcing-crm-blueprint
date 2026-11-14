export type Currency = 'USD' | 'CNY' | 'INR';
export type Price = { mode: string; base: Currency; amounts: Record<Currency, { min: number | null; max: number | null }> | null };
export type Category = { id: string; slug: string; name: string; parentId?: string | null; active?: boolean };
export type ProductImage = { id: string; kind?: string; altText?: string | null; url: string; cardUrl?: string | null; cover?: boolean; fileIds?: string[]; sort?: number };
export type TrustItem = { title: string; text: string };
export type Product = {
  id: string; slug: string; title: string; summary?: string | null; specs?: Record<string, unknown> | null;
  category?: { id?: string; slug: string | null; name: string | null } | null;
  moq?: number | null; unit?: string | null; leadTime?: string | null;
  price: Price; tiers?: { minQty: number; maxQty: number | null; amounts: Record<string, number | null> }[];
  images: ProductImage[]; isSample?: boolean; pinned?: boolean;
  status?: string; categoryId?: string | null; categoryName?: string | null; categorySlug?: string | null;
  priceMode?: string; baseCurrency?: string; priceMin?: number | null; priceMax?: number | null;
  deletedAt?: string | null; publishedAt?: string | null;
};
export type Banner = { id: string; sort: number; altText: string; imageUrl: string; mobileUrl?: string | null; href?: string | null; source?: string; isSample?: boolean; active?: boolean };
export type PromoStrip = { enabled: boolean; text: string; href: string };
export type CatalogStatus = { homepageEnabled: boolean; hasPublished: boolean; showMarketplace: boolean; trust?: TrustItem[]; promo?: PromoStrip };
export type BannerSettings = { direction: 'LTR' | 'RTL'; intervalSeconds: number };

export function photoSrc(img?: ProductImage | null, card = false) {
  if (!img) return '';
  return (card ? (img.cardUrl || img.url) : (img.url || img.cardUrl)) || '';
}
export function coverImage(images: ProductImage[] | undefined) {
  if (!images?.length) return undefined;
  return images.find((i) => i.cover) ?? images[0];
}
