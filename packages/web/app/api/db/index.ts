import { Pool } from 'pg'
import { delegate, perRequest } from '../request-scope'
import { postgresOptions } from './config'

const db = delegate(perRequest(() => {
  const pool = new Pool({
    ...postgresOptions(parseInt(process.env.POSTGRES_POOL_MAX ?? '4', 10)),
    application_name: `${process.env.POSTGRES_APPLICATION_NAME || 'kong:web'}:api:${process.env.VERCEL_ENV || 'local'}`.slice(0, 63),
    connectionTimeoutMillis: 5_000,
  })
  // Idle clients can be terminated by the server (e.g. read-replica recovery conflicts).
  // Without a listener, pg emits an unhandled 'error' event that crashes the process.
  pool.on('error', console.error)
  return pool
}))

export default db
