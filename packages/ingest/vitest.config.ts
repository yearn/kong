import { defineConfig } from 'vitest/config'

const shared = {
  globals: true,
  // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
  env: { TZ: 'UTC' },
  server: { deps: { inline: ['lib', 'db'] } },
  testTimeout: 60_000,
  hookTimeout: 60_000,
}

export default defineConfig({
  test: {
    teardownTimeout: 30_000,
    projects: [
      {
        test: {
          ...shared,
          globalSetup: ['./vitest.global.ts'],
          name: 'ingest',
          include: ['**/*.spec.ts'],
          exclude: ['**/node_modules/**', '**/*containers.spec.ts', '**/*.mock.spec.ts'],
          setupFiles: ['./vitest.setup.ts'],
          // one shared set of testcontainers + sequential execution: several specs
          // share the same tables, so they must not run in parallel.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
          isolate: false,
        },
      },
      {
        // Module-mocking specs: no containers, no shared setup. The ingest project
        // runs with isolate: false in one fork, so their vi.mock calls would leak.
        test: {
          ...shared,
          name: 'mocks',
          include: ['**/*.mock.spec.ts'],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./vitest.mocks.setup.ts'],
        },
      },
    ],
  },
})
