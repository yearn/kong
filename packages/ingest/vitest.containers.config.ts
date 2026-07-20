import { defineConfig } from 'vitest/config'

// e2e suite: each *containers.spec.ts owns a full TestEnvironment stack
// (postgres+redis+ingest+web) and mutates process.env for host-side pool/
// redis access. Run files in parallel, one isolated fork each.
export default defineConfig({
  test: {
    globals: true,
    // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
    env: { TZ: 'UTC' },
    include: ['**/*containers.spec.ts'],
    setupFiles: ['./vitest.containers.setup.ts'],
    pool: 'forks',
    fileParallelism: true,
    isolate: true,
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    teardownTimeout: 120_000,
    server: { deps: { inline: ['lib', 'db'] } },
  },
})
