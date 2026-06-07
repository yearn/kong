import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { POSTGRES_SSL: '', TZ: 'UTC' },
    exclude: ['**/containers.spec.ts', '**/*.containers.spec.ts', '**/node_modules/**', '**/dist/**', '**/build/**'],
    fileParallelism: false,
    globalSetup: ['./test.fixture.ts'],
    hookTimeout: 2 * 60_000,
    setupFiles: ['./test.setup.ts'],
    testTimeout: 2 * 60_000
  }
})
