import { buildApp } from './app.js';
import { UserStore } from './users.js';
import { openPg } from './db.js';
import { RedisBus } from './bus.js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
};
const secret = env('JWT_SECRET');
if (secret.length < 32) { console.error('JWT_SECRET must be at least 32 characters'); process.exit(1); }

// Source Easy's own PostgreSQL database (migrations run on open) + Redis (pub/sub for live streams, revocation, rate limits).
const db = await openPg(env('DATABASE_URL'), Number(process.env.PG_POOL ?? 6));
const bus = new RedisBus(env('REDIS_URL', 'redis://localhost:6379'));
const users = await new UserStore(db).load();
if (await users.bootstrap(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD, process.env.SUPER_ADMIN_NAME))
  console.log(`Bootstrapped super admin ${process.env.SUPER_ADMIN_EMAIL}`);

const app = await buildApp({
  db, bus, users, jwtSecret: secret, jwtTtl: process.env.JWT_TTL,
  downloadsDir: process.env.DOWNLOADS_DIR ?? '/opt/sourceeasy/downloads',
  webDir: process.env.WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname,
  backupLinks: process.env.BACKUP_LINKS ? JSON.parse(process.env.BACKUP_LINKS) : [],
  uploadsDir: env('UPLOADS_DIR', './data/uploads'),
  logger: true,
});
app.addHook('onClose', async () => { await bus.close(); await db.close(); });
for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => { void app.close().then(() => process.exit(0)); });
await app.listen({ host: env('HOST', '0.0.0.0'), port: Number(env('PORT', '8080')) });
