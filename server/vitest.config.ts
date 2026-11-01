import { defineConfig } from 'vitest/config';
// Each test boots a real in-memory PostgreSQL (PGlite) and runs the migrations, so allow more than the 5 s default.
export default defineConfig({ test: { testTimeout: 30000, hookTimeout: 30000 } });
