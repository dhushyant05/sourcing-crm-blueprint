import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Notifier, customerFcmFromEnv, disabledEmail, disabledPush, httpEmailFromEnv, render, safeVars, type EmailAdapter, type PushAdapter } from '../src/notify.js';
import { setup } from './portal-helpers.js';

const mocks = () => {
  const emails: any[] = [], pushes: any[] = [];
  const email: EmailAdapter = { enabled: true, async send(m) { emails.push(m); } };
  const push: PushAdapter = { enabled: true, async send(t, m) { pushes.push({ t, ...m }); return 'ok'; } };
  return { emails, pushes, email, push };
};
const wait = () => new Promise((r) => setTimeout(r, 150));

describe('customer notifications', () => {
  it('disabled by default: events are recorded in the outbox and SKIPPED (not_configured); nothing is sent', async () => {
    const { db, call, as, customer, orderFor } = await setup({ notifier: undefined });
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const lead = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    await orderFor(A.token, lead.id); await wait();
    const rows = (await call('sa', 'GET', '/api/notification-outbox')).json().data;
    expect(rows).toMatchObject({ email: false, push: false });
    expect(rows.rows.map((r: any) => `${r.channel}:${r.template}`).sort()).toEqual(['EMAIL:ORDER_CONFIRMED', 'EMAIL:QUOTE_READY', 'PUSH:ORDER_CONFIRMED', 'PUSH:QUOTE_READY']);
    expect(rows.rows.every((r: any) => r.status === 'SKIPPED' && r.reason === 'not_configured')).toBe(true);
    for (const who of ['ia', 'is', 'cs']) expect((await call(who, 'GET', '/api/notification-outbox')).statusCode).toBe(403);
    void db;
  });

  it('with (mock) adapters: only owners are notified, prefs respected, content is customer-safe', async () => {
    const m = mocks();
    const t = await setup({ makeNotifier: (db) => new Notifier(db, m.email, m.push, 'https://example.test/portal') });
    const A = await t.customer('Asha', '9876543210', 'Asha Traders');
    await t.db.run("UPDATE customer_users SET email = 'asha@example.test'");
    const dv = await t.as(A.token, 'POST', '/api/portal/me/devices', { token: 'tok-A-1', platform: 'android' }); if (dv.statusCode !== 204) console.log(dv.body);
    expect((await t.as(A.token, 'POST', '/api/portal/me/devices', { token: 'tok-A-1', platform: 'android' })).statusCode).toBe(204);
    expect((await t.as(A.token, 'POST', '/api/portal/me/devices', { token: 'bad token' })).statusCode).toBe(400);
    const lead = (await t.as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    await t.orderFor(A.token, lead.id); await wait();
    expect(m.emails.map((e) => e.subject)).toEqual(expect.arrayContaining([`Your quote ${lead.reference}-Q1 is ready`, `Order confirmed for ${lead.reference}`]));
    expect(m.emails.every((e) => e.to === 'asha@example.test')).toBe(true);
    expect(m.pushes.every((p) => p.t === 'tok-A-1')).toBe(true);
    const all = JSON.stringify([m.emails, m.pushes]);
    for (const secret of ['Ningbo', 'Mr Wang', 'wx_secret', 'CNY', 'Staff', 'supplier', 'password']) expect(all).not.toContain(secret);
    // A spoofed public enquiry with Asha's details (internal link only) never notifies her.
    const before = m.emails.length;
    const e = (await t.app.inject({ method: 'POST', url: '/api/public/enquiry', remoteAddress: '10.8.8.8', payload: { name: 'Asha', phone: '9876543210', company: 'Asha Traders', product: 'spoof' } })).json();
    await t.call('ia', 'GET', '/api/customers');
    const spoof = (await t.call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference);
    await t.orderFor('', spoof.id); await wait();
    expect(m.emails.length).toBe(before);
    // Opt out of email: next event is SKIPPED opted_out for email, push still goes.
    expect((await t.as(A.token, 'PUT', '/api/portal/me/notifications', { email: false })).json().data).toMatchObject({ email: false, push: true, emailAvailable: true });
    const sr = (await t.as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', goods: 'Lamps', destCity: 'Chennai', pickupCity: 'Yiwu' })).json().data;
    await t.call('ia', 'POST', `/api/shipping-requests/${sr.id}/freight-quotes`, { amount: 5000, internalCost: 3333 }); await wait();
    const out = (await t.call('sa', 'GET', '/api/notification-outbox')).json().data.rows.filter((r: any) => r.template === 'FREIGHT_QUOTE_READY');
    expect(out.find((r: any) => r.channel === 'EMAIL')).toMatchObject({ status: 'SKIPPED', reason: 'opted_out' });
    expect(out.find((r: any) => r.channel === 'PUSH')).toMatchObject({ status: 'SENT' });
    expect(JSON.stringify(m.pushes)).not.toContain('3333');
  });

  it('templates only take allowlisted variables; env adapters stay disabled without config; FCM/HTTP adapters build safe requests (mocked)', async () => {
    const v = safeVars({ name: 'Asha<script>', reference: 'SE-2611-0001', label: 'SE-2611-0001-Q1', link: 'https://x/portal', supplier: 'Ningbo', cost: 7 } as any);
    expect(Object.keys(v).sort()).toEqual(['label', 'link', 'name', 'reference']);
    expect(render('QUOTE_READY', v).body).not.toContain('<script>');
    expect(httpEmailFromEnv({})).toBe(disabledEmail);
    expect(httpEmailFromEnv({ NOTIFY_EMAIL_API_URL: 'http://insecure', NOTIFY_EMAIL_API_KEY: 'k', NOTIFY_EMAIL_FROM: 'a@b' })).toBe(disabledEmail);
    expect(customerFcmFromEnv({})).toBe(disabledPush);
    const calls: any[] = [];
    const http = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }); }) as typeof fetch;
    const em = httpEmailFromEnv({ NOTIFY_EMAIL_API_URL: 'https://mail.example.test/send', NOTIFY_EMAIL_API_KEY: 'k', NOTIFY_EMAIL_FROM: 'noreply@example.test' }, http);
    await em.send({ to: 'a@example.test', subject: 's', text: 't' });
    expect(calls[0].url).toBe('https://mail.example.test/send');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const dir = mkdtempSync(join(tmpdir(), 'fcm-')), f = join(dir, 'sa.json');
    writeFileSync(f, JSON.stringify({ client_email: 'x@example.test', project_id: 'customer-app-test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
    const p = customerFcmFromEnv({ CUSTOMER_FCM_SERVICE_ACCOUNT_JSON: f }, http);
    expect(p.enabled).toBe(true);
    expect(await p.send('tok', { title: 'T', body: 'B', data: { reference: 'SH-2611-0001' } })).toBe('ok');
    const msg = calls.find((c) => String(c.url).includes('customer-app-test/messages:send'));
    expect(JSON.parse(msg.init.body).message).toEqual({ token: 'tok', notification: { title: 'T', body: 'B' }, data: { reference: 'SH-2611-0001' } });
  });
});
