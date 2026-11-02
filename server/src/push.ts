/**
 * Mobile push (Firebase Cloud Messaging, HTTP v1). Device tokens are stored per user; sends are a no-op
 * unless FCM_SERVICE_ACCOUNT_JSON points at a Google service-account key file. Payloads carry no customer data
 * (same privacy-safe fields as in-app notifications).
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import type { Db } from './db.js';

interface Sa { client_email: string; private_key: string; project_id: string }
export interface PushMsg { title: string; body: string; data?: Record<string, string> }
type Fetch = typeof fetch;

export class PushStore {
  private sa: Sa | null = null;
  private tok: { v: string; exp: number } | null = null;
  constructor(private db: Db, saPath = process.env.FCM_SERVICE_ACCOUNT_JSON, private http: Fetch = fetch, sa?: Sa) {
    try { this.sa = sa ?? (saPath ? JSON.parse(readFileSync(saPath, 'utf8')) : null); } catch { this.sa = null; }
  }
  get enabled() { return !!this.sa; }
  async register(userId: string, token: string, platform = 'android') {
    if (!token || token.length > 4096) throw new Error('Invalid token');
    await this.db.run('INSERT INTO device_tokens (token,user_id,platform,updated_at) VALUES (?,?,?,now()) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()', token, userId, platform.slice(0, 20));
  }
  async unregister(userId: string, token?: string) {
    if (token) await this.db.run('DELETE FROM device_tokens WHERE token = ? AND user_id = ?', token, userId);
    else await this.db.run('DELETE FROM device_tokens WHERE user_id = ?', userId);
  }
  async tokens(userId: string): Promise<string[]> { return (await this.db.all<{ token: string }>('SELECT token FROM device_tokens WHERE user_id = ?', userId)).map((r) => r.token); }

  private async access(): Promise<string> {
    if (this.tok && this.tok.exp > Date.now() + 60_000) return this.tok.v;
    const sa = this.sa!, now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const r = await this.http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}` });
    if (!r.ok) throw new Error(`FCM auth ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  /** Sends to every device of these users; tokens FCM reports as unregistered are dropped. */
  async send(userIds: string[], m: PushMsg): Promise<number> {
    if (!this.sa || !userIds.length) return 0;
    let sent = 0;
    const at = await this.access();
    for (const u of new Set(userIds)) {
      for (const token of await this.tokens(u)) {
        const r = await this.http(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
          method: 'POST', headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { token, notification: { title: m.title, body: m.body }, data: m.data ?? {},
            android: { priority: 'HIGH', notification: { channel_id: 'alerts_bell', sound: 'bell' } } } }),
        });
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 400) await this.db.run('DELETE FROM device_tokens WHERE token = ?', token);
      }
    }
    return sent;
  }
}
