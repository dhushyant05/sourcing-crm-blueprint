/** Customer quote PDF: Source Easy branded (logo + sourceeasy.in only), INR only, no supplier identity or China cost. */
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cqTotals, type CustomerQuote } from './quotes.js';

const ASSETS = [join(dirname(fileURLToPath(import.meta.url)), '..', 'assets'), join(process.cwd(), 'assets')].find((d) => existsSync(join(d, 'NotoSans-Regular.ttf')));
export const TERM_LABEL: Record<string, string> = { EXW: 'EXW (Ex Works)', FOB: 'FOB (Free On Board)', CIF: 'CIF (Cost, Insurance & Freight)', CFR: 'CFR (Cost & Freight)',
  DDP: 'DDP (Delivered Duty Paid)', DAP: 'DAP (Delivered At Place)', DOOR: 'Door to door' };
export const MODE_LABEL: Record<string, string> = { AIR: 'Air', SEA: 'Sea', EXPRESS: 'Express / Courier', ROAD: 'Road' };
const inr = (n: number) => '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PdfInput { ref: string; label: string; product: string; customer: string | null; cq: CustomerQuote; moq: string | null; leadTime: string | null;
  date: string; photos: string[] }
export function customerQuotePdf(x: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Quotation ${x.label}`, Author: 'Source Easy' } });
    const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const R = ASSETS ? join(ASSETS, 'NotoSans-Regular.ttf') : 'Helvetica', B = ASSETS ? join(ASSETS, 'NotoSans-Bold.ttf') : 'Helvetica-Bold';
    const W = doc.page.width - 96, green = '#3d8b2f', ink = '#1f2937', mute = '#6b7280';
    if (ASSETS && existsSync(join(ASSETS, 'lockup.png'))) doc.image(join(ASSETS, 'lockup.png'), 48, 40, { height: 56 });
    doc.font(B).fontSize(18).fillColor(ink).text('QUOTATION', 48, 44, { width: W, align: 'right' });
    doc.font(R).fontSize(9).fillColor(mute).text('Sourcing made easy · sourceeasy.in', { width: W, align: 'right' });
    doc.moveTo(48, 108).lineTo(48 + W, 108).strokeColor(green).lineWidth(1.5).stroke();
    let y = 120;
    const kv = (k: string, v: string, xx: number, yy: number) => { doc.font(R).fontSize(8).fillColor(mute).text(k.toUpperCase(), xx, yy); doc.font(B).fontSize(10).fillColor(ink).text(v, xx, yy + 10, { width: W / 2 - 10 }); };
    kv('Quote no.', x.label, 48, y); kv('Date', x.date, 48 + W / 2, y); y += 32;
    if (x.customer) { kv('Prepared for', x.customer, 48, y); }
    kv('Valid until / validity', x.cq.validity || '—', 48 + W / 2, y); y += 36;
    doc.font(B).fontSize(13).fillColor(ink).text(x.product, 48, y, { width: W }); y = doc.y + 6;
    const meta = [x.moq && `MOQ: ${x.moq}`, x.leadTime && `Production lead time: ${x.leadTime}`].filter(Boolean).join('   ·   ');
    if (meta) { doc.font(R).fontSize(9).fillColor(mute).text(meta, 48, y, { width: W }); y = doc.y + 6; }
    // photos (up to 3)
    const ph = x.photos.slice(0, 3);
    if (ph.length) {
      const pw = (W - 16) / 3; let ok = 0;
      for (const p of ph) { try { doc.image(p, 48 + ok * (pw + 8), y, { fit: [pw, 120], align: 'center', valign: 'center' }); ok++; } catch { /* unsupported image */ } }
      if (ok) y += 128;
    }
    // price table
    const t = cqTotals(x.cq);
    y += 6; doc.rect(48, y, W, 20).fill('#eef6ea');
    const cols = [48 + 8, 48 + W * 0.5, 48 + W * 0.68, 48 + W * 0.84];
    doc.font(B).fontSize(9).fillColor(ink).text('Description', cols[0], y + 5).text('Qty', cols[1], y + 5, { width: W * 0.16, align: 'right' })
      .text('Rate', cols[2], y + 5, { width: W * 0.15, align: 'right' }).text('Amount', cols[3], y + 5, { width: W * 0.16 - 8, align: 'right' });
    y += 26;
    const row = (d: string, q: string, r: string, a: string, bold = false) => {
      doc.font(bold ? B : R).fontSize(9.5).fillColor(ink).text(d, cols[0], y, { width: W * 0.44 }); const h = doc.y;
      doc.text(q, cols[1], y, { width: W * 0.16, align: 'right' }).text(r, cols[2], y, { width: W * 0.15, align: 'right' }).text(a, cols[3], y, { width: W * 0.16 - 8, align: 'right' });
      y = Math.max(h, doc.y) + 6; doc.moveTo(48, y - 3).lineTo(48 + W, y - 3).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    };
    row(x.product, x.cq.qty.toLocaleString('en-IN'), inr(x.cq.unitPrice), inr(t.subtotal));
    const shipDesc = ['Shipping', x.cq.shipMode && MODE_LABEL[x.cq.shipMode], x.cq.shipTerm && TERM_LABEL[x.cq.shipTerm]].filter(Boolean).join(' · ');
    row(shipDesc, '', '', inr(x.cq.shipCost));
    if (x.cq.otherCharges) row(x.cq.otherLabel || 'Other charges', '', '', inr(x.cq.otherCharges));
    const tot = (k: string, v: string, bold = false) => { doc.font(bold ? B : R).fontSize(bold ? 11 : 9.5).fillColor(bold ? green : ink).text(k, 48 + W * 0.45, y, { width: W * 0.35, align: 'right' }).text(v, cols[3] - 20, y, { width: W * 0.16 + 12, align: 'right' }); y = doc.y + 4; };
    y += 4; tot('Product subtotal', inr(t.subtotal)); tot('Shipping', inr(x.cq.shipCost)); if (x.cq.otherCharges) tot(x.cq.otherLabel || 'Other charges', inr(x.cq.otherCharges));
    tot(`GST @ ${x.cq.gstPct}%`, inr(t.gst)); tot('Total (INR)', inr(t.total), true);
    y += 10;
    const ship = [['Shipping term', x.cq.shipTerm ? TERM_LABEL[x.cq.shipTerm] : null], ['Shipping mode', x.cq.shipMode ? MODE_LABEL[x.cq.shipMode] : null],
      ['Port / destination', x.cq.port], ['Transit time', x.cq.transit]].filter((r) => r[1]) as string[][];
    if (ship.length) {
      doc.font(B).fontSize(10).fillColor(ink).text('Shipping', 48, y); y = doc.y + 2;
      for (const [k, v] of ship) { doc.font(R).fontSize(9).fillColor(mute).text(`${k}: `, 48, y, { continued: true }).fillColor(ink).text(v); y = doc.y + 1; }
      y += 8;
    }
    if (x.cq.terms) { doc.font(B).fontSize(10).fillColor(ink).text('Terms & notes', 48, y); doc.font(R).fontSize(9).fillColor(ink).text(x.cq.terms, 48, doc.y + 2, { width: W }); }
    doc.page.margins.bottom = 0;
    doc.font(R).fontSize(8).fillColor(mute).text('Prices in Indian Rupees. Source Easy · Sourcing made easy · sourceeasy.in · Thank you for your business.',
      48, doc.page.height - 64, { width: W, align: 'center', lineBreak: true });
    doc.end();
  });
}
