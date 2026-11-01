// Runs the real server against an in-memory mock Twenty (test fixtures). Used for screenshots / UI dev without Twenty.
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from '../test/fixtures.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadStore } from '../src/uploads.js';
import { RefCounter } from '../src/refs.js';
import { backfill } from './backfill-refs.js';
const users = new UserStore();
for (const [e, n, r] of [['super@sourceeasy.in', 'Super Admin', 'SUPER_ADMIN'], ['china@sourceeasy.in', 'Li Wei', 'CHINA_STAFF'], ['india@sourceeasy.in', 'Rahul Mehta', 'INDIA_STAFF'], ['indiaadmin@sourceeasy.in', 'Priya Nair', 'INDIA_ADMIN']] as const)
  await users.create(e, n, r, 'demo-password-1');
const twenty = new MockTwenty();
// Seed one website enquiry with photos + documents so the lead detail shows attachments.
const uploadsDir = process.env.UPLOADS_DIR ?? mkdtempSync(join(tmpdir(), 'se-demo-up-'));
const lead = { id: 'lead-china-1' };
await twenty.update('leads', lead.id, { sourceChannel: 'WEBSITE', contactName: 'Rohit Mehta', unit: 'pcs', deliveryCity: 'Chennai',
  contactPhone: { primaryPhoneNumber: '9884412300', primaryPhoneCallingCode: '+91' },
  referenceUrl: { primaryLinkUrl: 'https://www.alibaba.com/product-detail/bamboo-cutting-board' },
  enquiryMessage: 'Need 3 sizes with juice groove and laser-engraved logo. Sample first please.', attachmentCount: 4 });
const pub = (f: string) => readFileSync(new URL(`../../web/public/demo/${f}`, import.meta.url));
new UploadStore(uploadsDir).save(lead.id, [
  { name: 'board-front.jpg', mime: 'image/jpeg', data: pub('bamboo-board-1.jpg') },
  { name: 'board-back.jpg', mime: 'image/jpeg', data: pub('bamboo-board-2.jpg') },
  { name: 'Mehta-bamboo-spec.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n% demo\n') },
  { name: 'sizes-and-quantities.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: Buffer.from('PK\x03\x04xl/') },
]);
const refs = new RefCounter();
await backfill(twenty, refs, false); // same path as production backfill: SE-YYMM-NNNN on leads + related records
const app = await buildApp({ twenty, users, uploadsDir, refs, jwtSecret: 'd'.repeat(40), webDir: new URL('../../web/dist', import.meta.url).pathname });
await app.listen({ port: Number(process.env.PORT ?? 8099), host: '127.0.0.1' });
console.log('demo server ready');
