import { afterAll, afterEach, beforeEach } from 'vitest';
import { opened } from './fixtures.js';

// Close Fastify apps (stops SLA/backfill timers, SSE pings) and PGlite databases when their scope ends.
// Without this every test leaked a full in-memory PostgreSQL, so workers grew in memory and later tests
// slowed past the timeout when the whole suite ran in parallel. Resources created in beforeAll stay open
// until afterAll; ones created inside a test are closed right after it.
let mark = 0;
const closeFrom = async (i: number) => { for (const x of opened.splice(i).reverse()) { try { await x.close(); } catch { /* already closed */ } } };
beforeEach(() => { mark = opened.length; });
afterEach(() => closeFrom(mark));
afterAll(() => closeFrom(0));
