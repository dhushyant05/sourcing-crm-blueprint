import { defineConfig } from 'vitest/config';
// Each test boots a real in-memory PostgreSQL (PGlite) and runs the migrations, so allow more than the 5 s default.
// Workers are capped at 4: each PGlite worker is CPU- and memory-heavy (WASM Postgres + bcrypt), and running one per
// core (8 here, next to other processes) starved tests past the timeout. test/teardown.ts closes every app/db per test.
export default defineConfig({ test: { testTimeout: 30000, hookTimeout: 30000, maxWorkers: 4, setupFiles: ['./test/teardown.ts'] } });
