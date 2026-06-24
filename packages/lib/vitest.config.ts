import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
    env: { TZ: 'UTC' },
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
    globalSetup: ['./vitest.global.ts'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    isolate: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    server: { deps: { inline: ['lib', 'db'] } },
  },
})
