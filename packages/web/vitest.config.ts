import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Pin TZ so date-bucketing specs are deterministic on any dev machine (CI runs UTC).
    env: { TZ: 'UTC' },
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    server: { deps: { inline: ['lib', 'db'] } },
  },
})
