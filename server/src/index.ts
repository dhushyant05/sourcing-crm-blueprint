import { buildApp } from './app.js';
import { TwentyRest } from './twenty.js';
import { UserStore } from './users.js';
import { RefCounter } from './refs.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
};
const secret = env('JWT_SECRET');
if (secret.length < 32) { console.error('JWT_SECRET must be at least 32 characters'); process.exit(1); }

const dbPath = env('USERS_DB', './data/users.db');
mkdirSync(dirname(dbPath), { recursive: true });
const users = new UserStore(dbPath);
if (await users.bootstrap(process.env.SUPER_ADMIN_EMAIL, process.env.SUPER_ADMIN_PASSWORD, process.env.SUPER_ADMIN_NAME))
  console.log(`Bootstrapped super admin ${process.env.SUPER_ADMIN_EMAIL}`);

const app = await buildApp({
  twenty: new TwentyRest(env('TWENTY_URL', 'http://localhost:3000'), env('TWENTY_API_KEY')),
  users, jwtSecret: secret, jwtTtl: process.env.JWT_TTL,
  downloadsDir: process.env.DOWNLOADS_DIR ?? '/opt/sourceeasy/downloads',
  webDir: process.env.WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname,
  backupLinks: process.env.BACKUP_LINKS ? JSON.parse(process.env.BACKUP_LINKS) : [],
  uploadsDir: env('UPLOADS_DIR', './data/uploads'),
  refs: new RefCounter(env('REFS_FILE', './data/refs.json')),
  logger: true,
});
await app.listen({ host: env('HOST', '0.0.0.0'), port: Number(env('PORT', '8080')) });
