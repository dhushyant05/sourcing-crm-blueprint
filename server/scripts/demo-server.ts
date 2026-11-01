// Runs the real server against an in-memory mock Twenty (test fixtures). Used for screenshots / UI dev without Twenty.
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from '../test/fixtures.js';
const users = new UserStore();
for (const [e, n, r] of [['super@sourceeasy.in', 'Super Admin', 'SUPER_ADMIN'], ['china@sourceeasy.in', 'Li Wei', 'CHINA_STAFF'], ['india@sourceeasy.in', 'Rahul Mehta', 'INDIA_STAFF'], ['indiaadmin@sourceeasy.in', 'Priya Nair', 'INDIA_ADMIN']] as const)
  await users.create(e, n, r, 'demo-password-1');
const app = await buildApp({ twenty: new MockTwenty(), users, jwtSecret: 'd'.repeat(40), webDir: new URL('../../web/dist', import.meta.url).pathname });
await app.listen({ port: Number(process.env.PORT ?? 8099), host: '127.0.0.1' });
console.log('demo server ready');
