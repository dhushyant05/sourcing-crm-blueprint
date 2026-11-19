/** Carton packing on a China supplier quote, and the public product packing derived from it. */
export type CartonInput = {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  unitsPerCarton: number | null;
  grossKg: number | null;
  netKg: number | null;
};

export type CartonTotals = CartonInput & {
  cbmPerCarton: number | null;
  cartonCount: number | null;
  totalCbm: number | null;
  totalGrossKg: number | null;
  totalNetKg: number | null;
};

const dim = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw Object.assign(new Error(`${what} must be a number greater than 0`), { status: 400 });
  return n;
};
const qty = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) throw Object.assign(new Error(`${what} must be a whole number of 1 or more`), { status: 400 });
  return n;
};
const weight = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${what} must be a number of 0 or more`), { status: 400 });
  return n;
};

export function parseMoqUnits(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const m = String(raw).replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Round to 6 decimal places (cubic metres). */
export function roundCbm(n: number) { return Math.round(n * 1e6) / 1e6; }
export function roundKg(n: number) { return Math.round(n * 1000) / 1000; }

export function parseCarton(b: Record<string, unknown>, cur?: Partial<CartonInput> | null): CartonInput {
  const has = (k: string) => k in b;
  const pick = (k: string, fallback: number | null, parse: (v: unknown, w: string) => number | null, label: string) =>
    has(k) ? parse(b[k], label) : fallback ?? null;
  return {
    lengthCm: pick('cartonLengthCm', cur?.lengthCm ?? null, dim, 'Carton length'),
    widthCm: pick('cartonWidthCm', cur?.widthCm ?? null, dim, 'Carton width'),
    heightCm: pick('cartonHeightCm', cur?.heightCm ?? null, dim, 'Carton height'),
    unitsPerCarton: pick('cartonUnits', cur?.unitsPerCarton ?? null, qty, 'Units per carton'),
    grossKg: pick('cartonGrossKg', cur?.grossKg ?? null, weight, 'Gross weight per carton'),
    netKg: pick('cartonNetKg', cur?.netKg ?? null, weight, 'Net weight per carton'),
  };
}

export function cartonTotals(c: CartonInput, moq?: unknown): CartonTotals {
  const cbmPerCarton = c.lengthCm != null && c.widthCm != null && c.heightCm != null
    ? roundCbm((c.lengthCm * c.widthCm * c.heightCm) / 1_000_000)
    : null;
  const moqN = parseMoqUnits(moq);
  const cartonCount = c.unitsPerCarton && moqN != null && moqN > 0
    ? Math.ceil(moqN / c.unitsPerCarton)
    : null;
  return {
    ...c,
    cbmPerCarton,
    cartonCount,
    totalCbm: cbmPerCarton != null && cartonCount != null ? roundCbm(cbmPerCarton * cartonCount) : null,
    totalGrossKg: c.grossKg != null && cartonCount != null ? roundKg(c.grossKg * cartonCount) : null,
    totalNetKg: c.netKg != null && cartonCount != null ? roundKg(c.netKg * cartonCount) : null,
  };
}

export function cartonHasValues(c: CartonInput | null | undefined): boolean {
  if (!c) return false;
  return c.lengthCm != null || c.widthCm != null || c.heightCm != null || c.unitsPerCarton != null || c.grossKg != null || c.netKg != null;
}

/** Staff + public packing block derived from a quote carton. showPublic defaults to true. */
export function packingFromCarton(c: CartonInput, moq?: unknown, showPublic = true) {
  if (!cartonHasValues(c)) return null;
  const t = cartonTotals(c, moq);
  const size = t.lengthCm != null && t.widthCm != null && t.heightCm != null
    ? `${t.lengthCm} × ${t.widthCm} × ${t.heightCm} cm`
    : null;
  return {
    sellingUnits: t.unitsPerCarton != null ? `${t.unitsPerCarton} pcs / carton` : null,
    singlePackageSize: size,
    grossWeight: t.grossKg != null ? `${t.grossKg} kg / carton` : null,
    packageType: 'Export carton',
    cartonLengthCm: t.lengthCm,
    cartonWidthCm: t.widthCm,
    cartonHeightCm: t.heightCm,
    unitsPerCarton: t.unitsPerCarton,
    grossWeightKg: t.grossKg,
    netWeightKg: t.netKg,
    cbmPerCarton: t.cbmPerCarton,
    cartonCount: t.cartonCount,
    totalCbm: t.totalCbm,
    totalGrossKg: t.totalGrossKg,
    totalNetKg: t.totalNetKg,
    showPublic,
  };
}

export function publicPacking<T extends { showPublic?: boolean | null }>(packing: T | null | undefined): T | null {
  if (!packing) return null;
  if (packing.showPublic === false) return null;
  return packing;
}
