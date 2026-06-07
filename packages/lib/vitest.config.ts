import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test.fixture.ts'],
    hookTimeout: 60_000,
    testTimeout: 5_000
  }
})
