export type Currency = 'USD' | 'CNY' | 'INR';
export type Price = { mode: string; base: Currency; amounts: Record<Currency, { min: number | null; max: number | null }> | null };
export type Category = { id: string; slug: string; name: string; parentId?: string | null; active?: boolean };
export type Breadcrumb = { id: string; slug: string; name: string };
export type CatalogSupplier = { company: string; region?: string | null; years?: number | null; verified?: boolean; about?: string | null };
export type PriceTier = { minQty: number; maxQty: number | null; amounts: Record<string, number | null> };
export type ProductImage = { id: string; kind?: string; altText?: string | null; url: string; cardUrl?: string | null; cover?: boolean; fileIds?: string[]; sort?: number };
export type TrustItem = { title: string; text: string };

export type VariationOption = { label: string; hex?: string | null };
export type ProductVariation = { name: string; options: VariationOption[] };
export type CustomizationOption = { label: string; moq?: number | null; note?: string | null };
export type LeadTimeTier = { minQty: number; maxQty: number | null; time: string };
export type AttrRow = { key: string; value: string };
export type SamplePrice = { amount: number; currency: Currency; leadTime?: string | null };
export type ShippingEstimate = { origin?: string | null; estimate?: string | null; note?: string | null };
export type PackingDetail = { sellingUnits?: string | null; singlePackageSize?: string | null; grossWeight?: string | null; packageType?: string | null };
export type Protection = { title: string; text: string };
export type Merchandising = {
  variations?: ProductVariation[];
  customizations?: CustomizationOption[];
  samplePrice?: SamplePrice | null;
  leadTimes?: LeadTimeTier[];
  shipping?: ShippingEstimate | null;
  protections?: Protection[];
  industryAttributes?: AttrRow[];
  otherAttributes?: AttrRow[];
  packing?: PackingDetail | null;
  description?: string | null;
  reviewsNote?: string | null;
};
export type Product = {
  id: string; slug: string; title: string; summary?: string | null; specs?: Record<string, unknown> | null;
  category?: { id?: string; slug: string | null; name: string | null } | null;
  breadcrumbs?: Breadcrumb[];
  moq?: number | null; unit?: string | null; leadTime?: string | null;
  capacity?: string | null; packaging?: string | null; customization?: string | null; samplePolicy?: string | null;
  price: Price; tiers?: PriceTier[];
  images: ProductImage[]; isSample?: boolean; pinned?: boolean; trending?: boolean; trendingScore?: number; viewCount?: number; enquiryCount?: number; tags?: string[];
  clearance?: boolean; clearancePrice?: Price | number | null; clearanceDiscountPct?: number | null; clearanceEndsAt?: string | null; clearanceStockLeft?: number | null;
  pinStartsAt?: string | null; pinEndsAt?: string | null;
  status?: string; categoryId?: string | null; categoryName?: string | null; categorySlug?: string | null; extraCategories?: { id: string; slug: string; name: string }[];
  priceMode?: string; baseCurrency?: string; priceMin?: number | null; priceMax?: number | null;
  deletedAt?: string | null; publishedAt?: string | null;
  merchandising?: Merchandising;
  supplier?: CatalogSupplier | null; supplierAvailable?: boolean;
  supplierId?: string | null; catalogSupplier?: { id: string; name: string; catalogConsent?: boolean; publicRegion?: string | null; publicAbout?: string | null; publicYears?: number | null; publicVerified?: boolean } | null;
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
