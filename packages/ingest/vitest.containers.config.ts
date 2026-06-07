import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { POSTGRES_SSL: '', TZ: 'UTC' },
    include: ['**/containers.spec.ts', '**/*.containers.spec.ts'],
    fileParallelism: false,
    hookTimeout: 20 * 60_000,
    testTimeout: 20 * 60_000
  }
})
