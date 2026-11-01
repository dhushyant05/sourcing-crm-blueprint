import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { sniff, validateFile } from '../src/uploads.js';
import { MockTwenty } from './fixtures.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

function form(fields: Record<string, string>, files: { name: string; data: Buffer; type?: string }[] = []) {
  const B = '----se' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
}

async function setup() {
  const twenty = new MockTwenty(), users = new UserStore();
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'se-up-')) });
  return { app, twenty, users };
}
const base = { name: 'Ravi', company: 'Ravi Traders', phoneCode: '+91', phone: '90000 00000', product: 'LED bulbs' };

describe('public enquiry', () => {
  it('creates a website lead, requires mobile, ignores bots, rate-limits', async () => {
    const { app, twenty } = await setup();
    const post = (body: object) => app.inject({ method: 'POST', url: '/api/public/enquiry', payload: body });
    expect((await post({ name: 'A' })).statusCode).toBe(400);
    expect((await post({ name: 'A', product: 'p', email: 'a@x.in' })).json().code).toBe('required'); // mobile is mandatory now
    expect((await post({ ...base, phone: '12345' })).json().code).toBe('phone');
    expect((await post({ name: 'Bot', product: 'x', phone: '1', website: 'spam' })).statusCode).toBe(202);
    const before = (await twenty.list('leads')).length;
    const r = await post({ ...base, phone: '+919000000000', quantity: '2000', unit: 'pcs', targetPrice: '1.5', currency: 'USD', deliveryCity: 'Chennai', referenceUrl: 'https://example.com/p', message: 'Warm white' });
    expect(r.statusCode).toBe(201);
    expect(r.json().reference).toMatch(/^SE-\d{4}-\d{4}$/);
    const leads = await twenty.list('leads');
    expect(leads.length).toBe(before + 1);
    expect(leads.at(-1)).toMatchObject({ clientName: 'Ravi Traders', sourceChannel: 'WEBSITE', status: 'NEW', quantity: 2000, unit: 'pcs',
      targetPrice: { amountMicros: 1500000, currencyCode: 'USD' }, contactPhone: { primaryPhoneNumber: '9000000000', primaryPhoneCallingCode: '+91' },
      deliveryCity: 'Chennai', referenceUrl: { primaryLinkUrl: 'https://example.com/p' }, enquiryMessage: 'Warm white', leadRef: r.json().reference });
    for (let i = 0; i < 4; i++) await post(base);
    expect((await post(base)).statusCode).toBe(429);
  });

  it('accepts multipart with photos/documents and serves them to staff of both sides who can read the lead', async () => {
    const { app, twenty, users } = await setup();
    const up = form(base, [{ name: 'photo.png', data: PNG, type: 'image/png' }, { name: 'spec.pdf', data: PDF }]);
    const r = await app.inject({ method: 'POST', url: '/api/public/enquiry', ...up });
    expect(r.statusCode).toBe(201);
    expect(r.json().attachments).toBe(2);
    const lead = (await twenty.list('leads')).at(-1)!;
    expect(lead.attachmentCount).toBe(2);

    for (const [email, role] of [['i@x.in', 'INDIA_STAFF'], ['c@x.in', 'CHINA_STAFF'], ['s@x.in', 'SUPER_ADMIN']] as const)
      await users.create(email, role, role, 'demo-password-1');
    const tok = async (email: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'demo-password-1' } })).json().token;
    const get = async (url: string, t?: string) => app.inject({ method: 'GET', url, headers: t ? { authorization: `Bearer ${t}` } : {} });
    const url = `/api/leads/${lead.id}/attachments`;
    expect((await get(url)).statusCode).toBe(401); // never public
    expect((await get(url, await tok('c@x.in'))).statusCode).toBe(404); // China: only once the lead is assigned to China
    await twenty.update('leads', String(lead.id), { assignedOffice: 'CHINA' });
    for (const e of ['i@x.in', 's@x.in', 'c@x.in']) {
      const t = await tok(e);
      const list = (await get(url, t)).json().data;
      expect(list.map((a: any) => [a.name, a.mime])).toEqual([['photo.png', 'image/png'], ['spec.pdf', 'application/pdf']]);
      const f = await get(`${url}/${list[0].id}`, t);
      expect(f.statusCode).toBe(200);
      expect(f.headers['content-type']).toBe('image/png');
      expect(f.headers['cache-control']).toBe('private, no-store');
      expect(f.rawPayload.equals(PNG)).toBe(true);
      expect((await get(`${url}/nope`, t)).statusCode).toBe(404);
    }
    expect((await get('/api/leads/../../etc/attachments', await tok('s@x.in'))).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects disguised, oversized and too many files', async () => {
    const { app, twenty } = await setup();
    const n = (await twenty.list('leads')).length;
    const send = (files: { name: string; data: Buffer }[]) => app.inject({ method: 'POST', url: '/api/public/enquiry', ...form(base, files) });
    expect((await send([{ name: 'evil.png', data: Buffer.from('<script>alert(1)</script>') }])).statusCode).toBe(415);
    expect((await send([{ name: 'x.exe', data: Buffer.from('MZ\x90\x00') }])).statusCode).toBe(415);
    expect((await send([{ name: 'photo.pdf', data: PNG }])).statusCode).toBe(415); // extension must match content
    expect((await send([{ name: 'big.pdf', data: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) }])).statusCode).toBe(413);
    expect((await send(Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.png`, data: PNG })))).statusCode).toBe(413);
    expect((await twenty.list('leads')).length).toBe(n); // nothing created
  });

  it('sniffs magic bytes', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniff(Buffer.from('\0\0\0\x18ftypheic\0\0'))).toBe('heic');
    expect(validateFile('a.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('word/document.xml')]))).toContain('wordprocessingml');
    expect(validateFile('a.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('xl/workbook.xml')]))).toContain('spreadsheetml');
    expect(validateFile('a.docx', Buffer.from([0x50, 0x4b, 3, 4, 1, 2]))).toBeNull(); // random zip
    expect(validateFile('a.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('application/vnd.ms-excel');
  });
});

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 7)]);
describe('lead media, summary and China assignment', () => {
  it('India uploads photo+video, assigns to China by status; China sees summary + media, no customer data', async () => {
    const { app, users } = await setup();
    for (const [email, role] of [['i@x.in', 'INDIA_STAFF'], ['c@x.in', 'CHINA_STAFF']] as const) await users.create(email, role, role, 'demo-password-1');
    const tok = async (email: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'demo-password-1' } })).json().token;
    const it_ = await tok('i@x.in'), ct = await tok('c@x.in');
    const h = (t: string) => ({ authorization: `Bearer ${t}` });
    const c = await app.inject({ method: 'POST', url: '/api/records/leads', headers: h(it_), payload: { name: 'Acme – Bulbs', clientName: 'Acme', productInterest: 'Bulbs', summary: '9W warm white, E27', status: 'NEW' } });
    expect(c.statusCode).toBe(201);
    const id = c.json().data.id;
    const up = form({}, [{ name: 'p.png', data: PNG }, { name: 'demo.mp4', data: MP4 }]);
    const u = await app.inject({ method: 'POST', url: `/api/leads/${id}/attachments`, ...up, headers: { ...up.headers, ...h(it_) } });
    expect(u.statusCode).toBe(201);
    expect(u.json().data.map((a: any) => a.mime)).toEqual(['image/png', 'video/mp4']);
    // China cannot upload, and cannot see it before assignment
    const up2 = form({}, [{ name: 'p.png', data: PNG }]);
    expect((await app.inject({ method: 'POST', url: `/api/leads/${id}/attachments`, ...up2, headers: { ...up2.headers, ...h(ct) } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/records/leads', headers: h(ct) })).json().data.find((l: any) => l.id === id)).toBeUndefined();
    // Board drag to ASSIGNED (status only) hands the lead to China
    expect((await app.inject({ method: 'PATCH', url: `/api/records/leads/${id}`, headers: h(it_), payload: { status: 'ASSIGNED' } })).statusCode).toBe(200);
    const l = (await app.inject({ method: 'GET', url: '/api/records/leads', headers: h(ct) })).json().data.find((x: any) => x.id === id);
    expect(l).toMatchObject({ assignedOffice: 'CHINA', summary: '9W warm white, E27', attachmentCount: 2 });
    expect(l.clientName).toBeUndefined(); expect(l.name).not.toContain('Acme');
    const list = (await app.inject({ method: 'GET', url: `/api/leads/${id}/attachments`, headers: h(ct) })).json().data;
    const v = await app.inject({ method: 'GET', url: `/api/leads/${id}/attachments/${list[1].id}`, headers: { ...h(ct), range: 'bytes=0-11' } });
    expect(v.statusCode).toBe(206);
    expect(v.headers['content-range']).toBe(`bytes 0-11/${MP4.length}`);
    expect(v.rawPayload.equals(MP4.subarray(0, 12))).toBe(true);
    const full = await app.inject({ method: 'GET', url: `/api/leads/${id}/attachments/${list[1].id}`, headers: h(ct) });
    expect(full.rawPayload.equals(MP4)).toBe(true); // original bytes
  });
});
