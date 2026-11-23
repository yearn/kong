import { Pool } from 'pg'
import { delegate, perRequest } from '../request-scope'
import { postgresOptions } from './config'

export const cronDb = delegate(perRequest(() => {
  const pool = new Pool({
    ...postgresOptions(parseInt(process.env.POSTGRES_CRON_POOL_MAX ?? '40', 10)),
    application_name: `${process.env.POSTGRES_APPLICATION_NAME || 'kong:web'}:cron:${process.env.VERCEL_ENV || 'local'}`.slice(0, 63),
    connectionTimeoutMillis: 60_000,
  })
  pool.on('error', console.error)
  return pool
}))
