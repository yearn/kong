import { Pool } from 'pg'
import { postgresConnection } from './config'

export const cronDb = new Pool({
  ...postgresConnection,
  application_name: `${process.env.POSTGRES_APPLICATION_NAME || 'kong:web'}:cron:${process.env.VERCEL_ENV || 'local'}`.slice(0, 63),
  max: parseInt(process.env.POSTGRES_CRON_POOL_MAX ?? '40', 10),
  connectionTimeoutMillis: 60_000,
})

cronDb.on('error', console.error)
