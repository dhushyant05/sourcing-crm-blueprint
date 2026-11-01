/**
 * One-off migration: Twenty CRM (leads, people, companies) + the old SQLite users.db → Source Easy's own PostgreSQL.
 * Ids are kept (lead ids are Twenty's uuids, so upload folders, notifications, events and quotes still line up).
 * Runs in one transaction; refuses to run on a non-empty target unless --force (which truncates it first).
 *
 *   DATABASE_URL=… TWENTY_PG_URL=… TWENTY_SCHEMA=workspace_… USERS_DB=/data/users.db UPLOADS_DIR=/data/uploads \
 *   node dist/migrate-legacy.js [--force]
 * Prints counts only (no secrets, no customer data).
 */
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { openPg, type Db } from './db.js';
import { UploadStore } from './uploads.js';
import { REF_RE } from './refs.js';

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing env ${k}`); process.exit(1); } return v; };
const schema = need('TWENTY_SCHEMA');
if (!/^workspace_[a-z0-9]+$/.test(schema)) { console.error('bad TWENTY_SCHEMA'); process.exit(1); }
const force = process.argv.includes('--force');
const nz = (v: unknown) => (v === '' || v === undefined ? null : v);
const bool = (v: unknown) => v === 1 || v === true || v === '1';

const tw = new pg.Client({ connectionString: need('TWENTY_PG_URL') });
await tw.connect();
const sq = new DatabaseSync(need('USERS_DB'), { readOnly: true });
const sAll = (sql: string) => sq.prepare(sql).all() as Record<string, any>[];
const sHas = (t: string) => !!sq.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const S = (t: string, order = 'rowid') => (sHas(t) ? sAll(`SELECT * FROM ${t} ORDER BY ${order}`) : []);
const db = await openPg(need('DATABASE_URL'), 2);

const TABLES = ['permission_audit', 'user_permissions', 'legacy_contacts', 'settings', 'lead_meta', 'sla_runs', 'sla_clocks', 'lead_events', 'notifications',
  'shipments', 'orders', 'quote_rejections', 'customer_quotes', 'quotes', 'suppliers', 'lead_media', 'leads', 'ref_counters', 'avatars', 'users'];
const existing = Number((await db.get<{ n: number }>('SELECT (SELECT count(*) FROM leads) + (SELECT count(*) FROM users) AS n'))!.n);
if (existing && !force) { console.error(`Target is not empty (${existing} rows in leads+users). Re-run with --force to replace.`); process.exit(2); }

const q = `"${schema}"`;
const leads = (await tw.query(`SELECT *, status::text AS st, "sourceChannel"::text AS sc, "assignedOffice"::text AS ao, office::text AS of FROM ${q}._lead WHERE "deletedAt" IS NULL ORDER BY "createdAt", id`)).rows;
const people = (await tw.query(`SELECT * FROM ${q}.person WHERE "deletedAt" IS NULL ORDER BY "createdAt"`)).rows;
const companies = (await tw.query(`SELECT * FROM ${q}.company WHERE "deletedAt" IS NULL ORDER BY "createdAt"`)).rows;
const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : nz(v));

const src: Record<string, number> = {};
const ins = async (t: Db, table: string, row: Record<string, unknown>) => {
  const ks = Object.keys(row);
  await t.run(`INSERT INTO ${table} (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, ...ks.map((k) => row[k]));
};

await db.tx(async (t) => {
  if (existing) await t.run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  // users + avatars
  for (const u of (src.users = 0, S('users', 'created_at, rowid'))) { src.users++;
    await ins(t, 'users', { id: u.id, email: u.email, name: u.name, role: u.role, password_hash: u.password_hash, active: bool(u.active), token_version: u.token_version ?? 0, language: nz(u.language), created_at: u.created_at }); }
  for (const a of S('avatars')) await ins(t, 'avatars', { user_id: a.user_id, data: Buffer.from(a.data), updated_at: a.updated_at });
  // leads (Twenty) + ownership/priority (SQLite)
  const asg = new Map(S('lead_assignments').map((r) => [r.lead_id, r]));
  const pri = new Map(S('lead_priority').map((r) => [r.lead_id, r]));
  for (const l of leads) {
    const a = asg.get(l.id), p = pri.get(l.id);
    await ins(t, 'leads', {
      id: l.id, legacy_id: l.id, lead_ref: nz(l.leadRef), name: nz(l.name), client_name: nz(l.clientName), contact_name: nz(l.contactName),
      contact_phone: nz(l.contactPhonePrimaryPhoneNumber), contact_phone_code: nz(l.contactPhonePrimaryPhoneCallingCode), contact_phone_country: nz(l.contactPhonePrimaryPhoneCountryCode),
      contact_email: nz(l.contactEmailPrimaryEmail), product_interest: nz(l.productInterest), quantity: l.quantity, unit: nz(l.unit),
      target_price: l.targetPriceAmountMicros == null ? null : Number(l.targetPriceAmountMicros) / 1e6, target_currency: nz(l.targetPriceCurrencyCode),
      delivery_city: nz(l.deliveryCity), reference_url: nz(l.referenceUrlPrimaryLinkUrl), enquiry_message: nz(l.enquiryMessage), summary: nz(l.summary),
      attachment_count: Math.round(Number(l.attachmentCount ?? 0)), source_channel: nz(l.sc), status: l.st ?? 'NEW', assigned_office: nz(l.ao),
      assigned_china_agent: nz(l.assignedChinaAgent), chatwoot_url: nz(l.chatwootConversationUrlPrimaryLinkUrl), win_loss_reason: nz(l.winLossReason),
      office: nz(l.of), client_ref: nz(l.clientRef),
      raised_by: nz(a?.raised_by), assigned_to: nz(a?.assigned_to), owner_office: nz(a?.owner_office), assigned_at: a ? a.updated_at : null,
      priority: p ? bool(p.priority) : false, priority_at: p ? p.updated_at : null,
      created_at: ts(l.createdAt), updated_at: ts(l.updatedAt) ?? ts(l.createdAt),
    });
    const m = REF_RE.exec(String(l.leadRef ?? ''));
    if (m) await t.run('INSERT INTO ref_counters (yymm, n) VALUES (?, ?) ON CONFLICT (yymm) DO UPDATE SET n = GREATEST(ref_counters.n, excluded.n)', m[1], Number(m[2]));
  }
  src.leads = leads.length;
  // the old refs.json counter (never go below a number already handed out)
  const refsFile = process.env.REFS_FILE;
  if (refsFile && existsSync(refsFile)) {
    const j = JSON.parse((await import('node:fs')).readFileSync(refsFile, 'utf8')) as Record<string, number>;
    for (const [k, n] of Object.entries(j)) if (/^\d{4}$/.test(k)) await t.run('INSERT INTO ref_counters (yymm, n) VALUES (?, ?) ON CONFLICT (yymm) DO UPDATE SET n = GREATEST(ref_counters.n, excluded.n)', k, Number(n));
  }
  // suppliers, quotes, customer quotes, rejections, orders, shipments
  for (const s of S('suppliers', 'created_at, rowid')) await ins(t, 'suppliers', { id: s.id, legacy_id: s.id, name: s.name, contact: nz(s.contact), phone: nz(s.phone), wechat: nz(s.wechat), city: nz(s.city), created_by: nz(s.created_by), created_at: s.created_at });
  for (const x of S('lead_quotes', 'created_at, rowid')) {
    await ins(t, 'quotes', { id: x.id, lead_id: x.lead_id, supplier_id: nz(x.supplier_id), product: x.product, unit_price: x.unit_price, currency: x.currency,
      moq: nz(x.moq), lead_time: nz(x.lead_time), validity: nz(x.validity), notes: nz(x.notes), ship_cost: x.ship_cost ?? null, ship_currency: nz(x.ship_currency),
      ship_term: nz(x.ship_term), ship_mode: nz(x.ship_mode), ship_port: nz(x.ship_port), ship_transit: nz(x.ship_transit), client_price: x.client_price ?? null,
      client_currency: nz(x.client_currency), client_notes: nz(x.client_notes), status: x.status ?? 'DRAFT', sent_at: nz(x.sent_at), decided_at: nz(x.decided_at),
      reject_reason: nz(x.reject_reason), pdf_token: nz(x.pdf_token), created_by: x.created_by, created_at: x.created_at, updated_at: x.updated_at });
    if (x.cq) { const c = JSON.parse(x.cq);
      await ins(t, 'customer_quotes', { quote_id: x.id, qty: c.qty, unit_price: c.unitPrice, gst_pct: c.gstPct ?? 0, ship_cost: c.shipCost ?? 0, ship_term: nz(c.shipTerm), ship_mode: nz(c.shipMode),
        port: nz(c.port), transit: nz(c.transit), other_charges: c.otherCharges ?? 0, other_label: nz(c.otherLabel), validity: nz(c.validity), terms: nz(c.terms), updated_at: x.updated_at }); }
  }
  for (const r of S('quote_rejections', 'at, rowid')) await ins(t, 'quote_rejections', { ...r, reason_text: nz(r.reason_text), resolution: nz(r.resolution), target_price: r.target_price ?? null, target_currency: nz(r.target_currency), notes: nz(r.notes), resolved_by: nz(r.resolved_by), resolved_at: nz(r.resolved_at) });
  for (const o of S('orders', 'created_at, rowid')) await ins(t, 'orders', { ...o, lead_ref: nz(o.lead_ref), expected_ship: nz(o.expected_ship), tracking: nz(o.tracking), container: nz(o.container), etd: nz(o.etd), eta: nz(o.eta) });
  for (const s of S('shipments', 'created_at, rowid')) await ins(t, 'shipments', { ...s, legacy_id: s.id, status: s.status === 'SHIPPED' ? 'IN_TRANSIT' : s.status,
    mode: nz(s.mode), incoterm: nz(s.incoterm), port: nz(s.port), transit: nz(s.transit), carrier: nz(s.carrier), tracking: nz(s.tracking), container: nz(s.container),
    etd: nz(s.etd), eta: nz(s.eta), customs_note: nz(s.customs_note), delivered_at: nz(s.delivered_at) });
  // notifications, timeline, SLA, lost-lead meta, settings
  for (const n of S('notifications', 'created_at, rowid')) await ins(t, 'notifications', { ...n, lead_ref: nz(n.lead_ref), product: nz(n.product), by_name: nz(n.by_name), detail: nz(n.detail), read_at: nz(n.read_at) });
  for (const e of S('lead_events', 'at, rowid')) await ins(t, 'lead_events', { ...e, data: e.data || '{}' });
  for (const c of S('lead_clock')) await ins(t, 'sla_clocks', { ...c, warned: bool(c.warned), breached: bool(c.breached) });
  for (const r of S('lead_clock_runs', 'ended_at, rowid')) await ins(t, 'sla_runs', { ...r, breached: bool(r.breached) });
  for (const m of S('lead_meta')) await ins(t, 'lead_meta', { ...m, follow_up_sent: bool(m.follow_up_sent) });
  for (const s of S('app_settings')) await t.run('INSERT INTO settings (key, value) VALUES (?, ?::jsonb)', s.key, s.key.startsWith('once:') ? JSON.stringify(s.value) : s.value);
  // people / companies that only lived in Twenty
  for (const p of people) await ins(t, 'legacy_contacts', { id: p.id, kind: 'person', name: [p.nameFirstName, p.nameLastName].filter(Boolean).join(' ') || null,
    email: nz(p.emailsPrimaryEmail), phone: nz([p.phonesPrimaryPhoneCallingCode, p.phonesPrimaryPhoneNumber].filter(Boolean).join(' ')), company: nz(p.companyId), data: JSON.stringify(p), created_at: ts(p.createdAt) });
  for (const c of companies) await ins(t, 'legacy_contacts', { id: c.id, kind: 'company', name: nz(c.name), email: null, phone: null, company: null, data: JSON.stringify(c), created_at: ts(c.createdAt) });
  // media index from the uploads volume (bytes stay where they are)
  const dir = process.env.UPLOADS_DIR;
  if (dir && existsSync(dir)) {
    const up = new UploadStore(dir);
    for (const key of readdirSync(dir).filter((k) => !k.startsWith('.'))) {
      const list = up.list(key);
      for (const a of list) await ins(t, 'lead_media', { id: a.id, owner_key: key, name: a.name, mime: a.mime, size: a.size, created_at: a.createdAt });
      if (!key.startsWith('q_')) await t.run('UPDATE leads SET attachment_count = ? WHERE id = ?', list.length, key);
    }
  }
});

// ---- verify: source vs target counts ----
const pairs: [string, number, string][] = [
  ['users', S('users').length, 'users'], ['avatars', S('avatars').length, 'avatars'], ['leads (Twenty)', leads.length, 'leads'],
  ['suppliers', S('suppliers').length, 'suppliers'], ['lead_quotes', S('lead_quotes').length, 'quotes'],
  ['quotes with customer quote', S('lead_quotes').filter((x) => x.cq).length, 'customer_quotes'], ['quote_rejections', S('quote_rejections').length, 'quote_rejections'],
  ['orders', S('orders').length, 'orders'], ['shipments', S('shipments').length, 'shipments'], ['notifications', S('notifications').length, 'notifications'],
  ['lead_events', S('lead_events').length, 'lead_events'], ['lead_clock', S('lead_clock').length, 'sla_clocks'], ['lead_clock_runs', S('lead_clock_runs').length, 'sla_runs'],
  ['lead_meta', S('lead_meta').length, 'lead_meta'], ['app_settings', S('app_settings').length, 'settings'], ['person+company', people.length + companies.length, 'legacy_contacts'],
];
let ok = true;
for (const [s, n, table] of pairs) {
  const m = Number((await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n);
  if (m !== n) ok = false;
  console.log(`${m === n ? 'OK  ' : 'DIFF'} ${s.padEnd(28)} source ${String(n).padStart(4)} → ${table} ${m}`);
}
console.log('lead_media rows', Number((await db.get('SELECT count(*) AS n FROM lead_media'))!.n), '| ref_counters', JSON.stringify(await db.all('SELECT yymm, n FROM ref_counters ORDER BY yymm')));
const orphan = await db.all(`SELECT 'quote' k, count(*) n FROM quotes WHERE lead_id NOT IN (SELECT id FROM leads) UNION ALL
  SELECT 'order', count(*) FROM orders WHERE lead_id NOT IN (SELECT id FROM leads) UNION ALL SELECT 'notification', count(*) FROM notifications WHERE lead_id NOT IN (SELECT id FROM leads)
  UNION ALL SELECT 'event', count(*) FROM lead_events WHERE lead_id NOT IN (SELECT id FROM leads)`);
console.log('rows pointing at a lead that does not exist:', JSON.stringify(orphan));
await tw.end(); sq.close(); await db.close();
if (!ok) { console.error('COUNT MISMATCH'); process.exit(3); }
console.log('MIGRATION OK');
