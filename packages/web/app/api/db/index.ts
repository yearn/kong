import { Pool } from 'pg'
import { postgresConnection } from './config'

const db = new Pool({
  ...postgresConnection,
  application_name: `${process.env.POSTGRES_APPLICATION_NAME || 'kong:web'}:api:${process.env.VERCEL_ENV || 'local'}`.slice(0, 63),
  max: parseInt(process.env.POSTGRES_POOL_MAX ?? '4', 10),
  connectionTimeoutMillis: 5_000,
})

// Idle clients can be terminated by the server (e.g. read-replica recovery conflicts).
// Without a listener, pg emits an unhandled 'error' event that crashes the process.
db.on('error', console.error)

export default db
