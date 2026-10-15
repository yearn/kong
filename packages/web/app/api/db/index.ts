import { Pool } from 'pg'
import { postgresConnection } from './config'

const db = new Pool({
  ...postgresConnection,
  max: parseInt(process.env.POSTGRES_POOL_MAX ?? '4', 10),
  connectionTimeoutMillis: 5_000,
})

export default db
