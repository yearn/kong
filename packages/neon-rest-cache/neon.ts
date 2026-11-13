import { defineConfig } from '@neon/config/v1'

const adminToken = process.env.REST_CACHE_ADMIN_TOKEN
const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL

if (!adminToken?.trim()) {
  throw new Error('Set REST_CACHE_ADMIN_TOKEN before applying the Neon Function configuration')
}

export default defineConfig({
  functions: {
    restcache: {
      name: 'REST cache refresh',
      source: './dist/function',
      bundler: 'none',
      env: {
        REST_CACHE_ADMIN_TOKEN: adminToken,
        REST_CACHE_USE_SOURCE_REPLICA: sourceDatabaseUrl ? 'true' : 'false',
        ...(sourceDatabaseUrl ? { SOURCE_DATABASE_URL: sourceDatabaseUrl } : {}),
        REST_CACHE_HISTORICAL_FULL_REFRESH: process.env.REST_CACHE_HISTORICAL_FULL_REFRESH ?? 'false',
      },
    },
  },
  branch: () => ({
    functions: {
      restcache: { runtime: 'nodejs24' },
    },
  }),
  triggers: {
    'refresh-cache': {
      type: 'schedule',
      function: 'restcache',
      cron: '*/30 * * * *',
      functionPath: '/jobs/refresh-cache',
      enabled: false,
    },
    'tvl-refresh': {
      type: 'schedule',
      function: 'restcache',
      cron: '*/30 * * * *',
      functionPath: '/jobs/tvl-refresh',
      enabled: false,
    },
    'timeseries-refresh': {
      type: 'schedule',
      function: 'restcache',
      cron: '0 * * * *',
      functionPath: '/jobs/timeseries-refresh',
      enabled: false,
    },
    'timeseries-refresh-historical': {
      type: 'schedule',
      function: 'restcache',
      cron: '15 2 * * *',
      functionPath: '/jobs/timeseries-refresh-historical',
      enabled: false,
    },
  },
})
