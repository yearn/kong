import { Pool } from 'pg'
import { postgresConnection } from './config'

export const cronDb = new Pool({
  ...postgresConnection,
  max: parseInt(process.env.POSTGRES_CRON_POOL_MAX ?? '40', 10),
  connectionTimeoutMillis: 60_000,
})

cronDb.on('error', console.error)
