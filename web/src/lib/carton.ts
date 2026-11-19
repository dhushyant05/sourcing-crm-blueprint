export type CartonFields = {
  cartonLengthCm?: number | string | null;
  cartonWidthCm?: number | string | null;
  cartonHeightCm?: number | string | null;
  cartonUnits?: number | string | null;
  cartonGrossKg?: number | string | null;
  cartonNetKg?: number | string | null;
  moq?: string | number | null;
};

const n = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const x = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  return Number.isFinite(x) ? x : null;
};

export function parseMoqUnits(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const m = String(raw).replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function cartonMath(f: CartonFields) {
  const lengthCm = n(f.cartonLengthCm);
  const widthCm = n(f.cartonWidthCm);
  const heightCm = n(f.cartonHeightCm);
  const unitsPerCarton = n(f.cartonUnits);
  const grossKg = n(f.cartonGrossKg);
  const netKg = n(f.cartonNetKg);
  const cbmPerCarton = lengthCm && widthCm && heightCm && lengthCm > 0 && widthCm > 0 && heightCm > 0
    ? Math.round((lengthCm * widthCm * heightCm) / 1_000_000 * 1e6) / 1e6
    : null;
  const moqN = parseMoqUnits(f.moq);
  const cartonCount = unitsPerCarton && unitsPerCarton >= 1 && moqN != null && moqN > 0
    ? Math.ceil(moqN / Math.floor(unitsPerCarton))
    : null;
  const roundKg = (x: number) => Math.round(x * 1000) / 1000;
  return {
    lengthCm, widthCm, heightCm, unitsPerCarton, grossKg, netKg, cbmPerCarton, cartonCount,
    totalCbm: cbmPerCarton != null && cartonCount != null ? Math.round(cbmPerCarton * cartonCount * 1e6) / 1e6 : null,
    totalGrossKg: grossKg != null && cartonCount != null ? roundKg(grossKg * cartonCount) : null,
    totalNetKg: netKg != null && cartonCount != null ? roundKg(netKg * cartonCount) : null,
  };
}

export function fmtCbm(n: number | null | undefined) {
  if (n == null) return '—';
  const s = n >= 0.01 ? n.toFixed(4) : n.toFixed(6);
  return `${s.replace(/\.?0+$/, '')} m³`;
}

export function fmtKg(n: number | null | undefined) {
  if (n == null) return '—';
  return `${n} kg`;
}

export function packingLines(p: (CartonFields & { packing?: any }) | null | undefined): { label: string; value: string }[] {
  if (!p) return [];
  const raw = p.packing ?? cartonMath(p);
  const t = {
    lengthCm: raw.lengthCm ?? raw.cartonLengthCm,
    widthCm: raw.widthCm ?? raw.cartonWidthCm,
    heightCm: raw.heightCm ?? raw.cartonHeightCm,
    unitsPerCarton: raw.unitsPerCarton,
    grossKg: raw.grossKg ?? raw.grossWeightKg,
    netKg: raw.netKg ?? raw.netWeightKg,
    cbmPerCarton: raw.cbmPerCarton,
    cartonCount: raw.cartonCount,
    totalCbm: raw.totalCbm,
    totalGrossKg: raw.totalGrossKg,
    totalNetKg: raw.totalNetKg,
  };
  const rows: { label: string; value: string }[] = [];
  if (t.lengthCm && t.widthCm && t.heightCm) rows.push({ label: 'Carton size', value: `${t.lengthCm} × ${t.widthCm} × ${t.heightCm} cm` });
  else if (t.lengthCm || t.widthCm || t.heightCm) rows.push({ label: 'Carton size', value: [t.lengthCm, t.widthCm, t.heightCm].map((x) => (x == null ? '—' : `${x}`)).join(' × ') + ' cm' });
  if (t.unitsPerCarton) rows.push({ label: 'Units / carton', value: String(t.unitsPerCarton) });
  if (t.grossKg != null) rows.push({ label: 'Gross / carton', value: fmtKg(t.grossKg) });
  if (t.netKg != null) rows.push({ label: 'Net / carton', value: fmtKg(t.netKg) });
  if (t.cbmPerCarton != null) rows.push({ label: 'CBM / carton', value: fmtCbm(t.cbmPerCarton) });
  if (t.cartonCount != null) rows.push({ label: 'Cartons for MOQ', value: String(t.cartonCount) });
  if (t.totalCbm != null) rows.push({ label: 'Total CBM (MOQ)', value: fmtCbm(t.totalCbm) });
  if (t.totalGrossKg != null) rows.push({ label: 'Total gross (MOQ)', value: fmtKg(t.totalGrossKg) });
  if (t.totalNetKg != null) rows.push({ label: 'Total net (MOQ)', value: fmtKg(t.totalNetKg) });
  return rows;
}
