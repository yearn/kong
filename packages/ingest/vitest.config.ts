import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
    env: { TZ: 'UTC' },
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/*containers.spec.ts'],
    globalSetup: ['./vitest.global.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // one shared set of testcontainers + sequential execution: several specs
    // share the same tables, so they must not run in parallel.
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
