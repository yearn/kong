import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    env: { TZ: 'UTC' },
    testTimeout: 10_000,
  },
})
