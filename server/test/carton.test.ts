import { describe, expect, it } from 'vitest';
import { cartonTotals, parseCarton, packingFromCarton, publicPacking, parseMoqUnits } from '../src/carton.js';

describe('carton packing maths', () => {
  it('computes CBM per carton and MOQ totals, and parses MOQ text', () => {
    expect(parseMoqUnits('1000 pcs')).toBe(1000);
    const t = cartonTotals({
      lengthCm: 50, widthCm: 40, heightCm: 30, unitsPerCarton: 20, grossKg: 12.5, netKg: 11,
    }, '100 pcs');
    expect(t.cbmPerCarton).toBe(0.06);
    expect(t.cartonCount).toBe(5);
    expect(t.totalCbm).toBe(0.3);
    expect(t.totalGrossKg).toBe(62.5);
    expect(t.totalNetKg).toBe(55);
  });

  it('leaves totals empty when dimensions or units are missing, and rejects bad values', () => {
    const partial = cartonTotals({ lengthCm: 50, widthCm: 40, heightCm: null, unitsPerCarton: 10, grossKg: 2, netKg: null }, 100);
    expect(partial.cbmPerCarton).toBeNull();
    expect(partial.cartonCount).toBe(10);
    expect(partial.totalGrossKg).toBe(20);
    expect(() => parseCarton({ cartonLengthCm: 0 })).toThrow(/greater than 0/i);
    expect(() => parseCarton({ cartonUnits: 0.5 })).toThrow(/whole number/i);
  });

  it('builds a public packing block that can be hidden', () => {
    const pack = packingFromCarton({ lengthCm: 10, widthCm: 10, heightCm: 10, unitsPerCarton: 5, grossKg: 1, netKg: null }, 20);
    expect(pack?.singlePackageSize).toBe('10 × 10 × 10 cm');
    expect(pack?.cbmPerCarton).toBe(0.001);
    expect(pack?.cartonCount).toBe(4);
    expect(pack?.showPublic).toBe(true);
    expect(publicPacking(pack)?.totalCbm).toBe(0.004);
    expect(publicPacking({ ...pack!, showPublic: false })).toBeNull();
  });
});
