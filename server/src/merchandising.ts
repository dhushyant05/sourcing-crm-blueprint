const CURRENCIES = ['USD', 'CNY', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type VariationOption = { label: string; hex: string | null };
export type Variation = { name: string; options: VariationOption[] };
export type CustomizationOption = { label: string; moq: number | null; note: string | null };
export type LeadTimeTier = { minQty: number; maxQty: number | null; time: string };
export type AttrRow = { key: string; value: string };
export type SamplePrice = { amount: number; currency: Currency; leadTime: string | null };
export type ShippingEstimate = { origin: string | null; estimate: string | null; note: string | null };
export type PackingDetail = {
  sellingUnits: string | null;
  singlePackageSize: string | null;
  grossWeight: string | null;
  packageType: string | null;
  cartonLengthCm?: number | null;
  cartonWidthCm?: number | null;
  cartonHeightCm?: number | null;
  unitsPerCarton?: number | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  cbmPerCarton?: number | null;
  cartonCount?: number | null;
  totalCbm?: number | null;
  totalGrossKg?: number | null;
  totalNetKg?: number | null;
  /** When false, packing dims and weight are hidden on the public product page. Default true. */
  showPublic?: boolean;
};
export type Protection = { title: string; text: string };
export type Merchandising = {
  variations: Variation[];
  customizations: CustomizationOption[];
  samplePrice: SamplePrice | null;
  leadTimes: LeadTimeTier[];
  shipping: ShippingEstimate | null;
  protections: Protection[];
  industryAttributes: AttrRow[];
  otherAttributes: AttrRow[];
  packing: PackingDetail | null;
  description: string | null;
  reviewsNote: string | null;
};

export const DEFAULT_SOURCE_EASY_PROTECTIONS: Protection[] = [
  {
    title: 'Source Easy quote first',
    text: 'This page is not a checkout. The Source Easy team confirms price, quantity and terms before any order is placed.',
  },
  {
    title: 'India and China offices',
    text: 'Orders and follow-ups are coordinated by Source Easy staff in India and China, not by an unvetted online checkout.',
  },
  {
    title: 'Production follow-up',
    text: 'Inspections, production photos and packing checks can be arranged when you ask for them with your quote.',
  },
  {
    title: 'Documented shipment',
    text: 'Photos, invoices and packing lists can be attached to your enquiry and kept with the request in the Source Easy CRM.',
  },
];

const empty = (): Merchandising => ({
  variations: [],
  customizations: [],
  samplePrice: null,
  leadTimes: [],
  shipping: null,
  protections: [],
  industryAttributes: [],
  otherAttributes: [],
  packing: null,
  description: null,
  reviewsNote: null,
});

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
const num = (s: unknown) => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function attrs(raw: unknown, cap = 30): AttrRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AttrRow[] = [];
  for (const row of raw.slice(0, cap)) {
    if (!row || typeof row !== 'object') continue;
    const key = clip((row as any).key ?? (row as any).name, 80);
    const value = clip((row as any).value, 400);
    if (key && value) out.push({ key, value });
  }
  return out;
}

function hexOf(raw: unknown): string | null {
  let hex = clip(raw, 16);
  if (!hex) return null;
  if (!hex.startsWith('#')) hex = `#${hex}`;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex) ? hex : null;
}

export function normalizeMerchandising(raw: unknown): Merchandising {
  const out = empty();
  let src: any = raw;
  if (raw == null || raw === '') return out;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return out; }
  }
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;

  if (Array.isArray(src.variations)) {
    for (const v of src.variations.slice(0, 8)) {
      const name = clip(v?.name, 40);
      if (!name) continue;
      const options: VariationOption[] = [];
      const list = Array.isArray(v?.options) ? v.options : [];
      for (const o of list.slice(0, 24)) {
        const label = clip(typeof o === 'string' ? o : o?.label, 40);
        if (!label) continue;
        options.push({ label, hex: typeof o === 'object' ? hexOf(o?.hex) : null });
      }
      if (options.length) out.variations.push({ name, options });
    }
  }

  if (Array.isArray(src.customizations)) {
    for (const c of src.customizations.slice(0, 12)) {
      const label = clip(c?.label ?? c?.type ?? c?.name, 80);
      if (!label) continue;
      out.customizations.push({
        label,
        moq: num(c?.moq) != null ? Math.floor(num(c?.moq)!) : null,
        note: clip(c?.note, 400) || null,
      });
    }
  }

  const sp = src.samplePrice;
  if (sp && typeof sp === 'object') {
    const amount = num(sp.amount);
    const currency = CURRENCIES.includes(sp.currency) ? sp.currency as Currency : 'USD';
    if (amount != null) out.samplePrice = { amount, currency, leadTime: clip(sp.leadTime, 80) || null };
  }

  if (Array.isArray(src.leadTimes)) {
    for (const t of src.leadTimes.slice(0, 12)) {
      const minQty = num(t?.minQty);
      const time = clip(t?.time ?? t?.days, 80);
      if (minQty == null || !time) continue;
      const maxQty = num(t?.maxQty);
      out.leadTimes.push({ minQty: Math.floor(minQty), maxQty: maxQty != null ? Math.floor(maxQty) : null, time });
    }
  }

  const sh = src.shipping;
  if (sh && typeof sh === 'object') {
    const origin = clip(sh.origin, 120) || null;
    const estimate = clip(sh.estimate, 200) || null;
    const note = clip(sh.note, 800) || null;
    if (origin || estimate || note) out.shipping = { origin, estimate, note };
  }

  if (Array.isArray(src.protections)) {
    for (const p of src.protections.slice(0, 8)) {
      const title = clip(p?.title, 80);
      const text = clip(p?.text, 400);
      if (title && text) out.protections.push({ title, text });
    }
  }

  out.industryAttributes = attrs(src.industryAttributes);
  out.otherAttributes = attrs(src.otherAttributes);

  const pk = src.packing;
  if (pk && typeof pk === 'object') {
    const sellingUnits = clip(pk.sellingUnits, 120) || null;
    const singlePackageSize = clip(pk.singlePackageSize, 120) || null;
    const grossWeight = clip(pk.grossWeight, 80) || null;
    const packageType = clip(pk.packageType, 200) || null;
    const pos = (v: unknown, min = 0) => {
      const n = num(v);
      return n != null && n >= min ? n : null;
    };
    const carton = {
      cartonLengthCm: pos(pk.cartonLengthCm, 0.001),
      cartonWidthCm: pos(pk.cartonWidthCm, 0.001),
      cartonHeightCm: pos(pk.cartonHeightCm, 0.001),
      unitsPerCarton: pos(pk.unitsPerCarton, 1) != null ? Math.floor(pos(pk.unitsPerCarton, 1)!) : null,
      grossWeightKg: pos(pk.grossWeightKg, 0),
      netWeightKg: pos(pk.netWeightKg, 0),
      cbmPerCarton: pos(pk.cbmPerCarton, 0),
      cartonCount: pos(pk.cartonCount, 1) != null ? Math.floor(pos(pk.cartonCount, 1)!) : null,
      totalCbm: pos(pk.totalCbm, 0),
      totalGrossKg: pos(pk.totalGrossKg, 0),
      totalNetKg: pos(pk.totalNetKg, 0),
    };
    const hasCarton = Object.values(carton).some((v) => v != null);
    if (sellingUnits || singlePackageSize || grossWeight || packageType || hasCarton) {
      out.packing = { sellingUnits, singlePackageSize, grossWeight, packageType, ...carton, showPublic: pk.showPublic === false ? false : true };
    }
  }

  out.description = clip(src.description, 20000) || null;
  out.reviewsNote = clip(src.reviewsNote, 400) || null;
  return out;
}

export function parseMerchandising(raw: unknown): Merchandising {
  return normalizeMerchandising(raw);
}

/** Public payload always includes Source Easy protections when none were saved. */
export function publicMerchandising(raw: unknown): Merchandising {
  const m = normalizeMerchandising(raw);
  if (!m.protections.length) m.protections = DEFAULT_SOURCE_EASY_PROTECTIONS.map((p) => ({ ...p }));
  if (m.packing && m.packing.showPublic === false) m.packing = null;
  return m;
}
