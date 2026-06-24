import { defineConfig } from 'vitest/config'

// e2e suite: each spec brings up its own full ingest+web stack via
// lib/helpers/containers, so there is no shared testcontainers globalSetup here.
export default defineConfig({
  test: {
    globals: true,
    // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
    env: { TZ: 'UTC' },
    include: ['**/*containers.spec.ts'],
    setupFiles: ['./vitest.containers.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    isolate: false,
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    teardownTimeout: 120_000,
    server: { deps: { inline: ['lib', 'db'] } },
  },
})
