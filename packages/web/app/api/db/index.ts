import { Pool, types as pgTypes } from 'pg'

// Convert timestamptz (OID 1184) to seconds
pgTypes.setTypeParser(1184, (stringValue) => {
  return BigInt(Math.floor(Date.parse(stringValue) / 1000))
})

const connection = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: (process.env.POSTGRES_PORT ?? 5432) as number,
  ssl: (process.env.POSTGRES_SSL ?? false) as boolean,
  database: process.env.POSTGRES_DATABASE ?? 'user',
  user: process.env.POSTGRES_USER ?? 'user',
  password: process.env.POSTGRES_PASSWORD ?? 'password',
  idleTimeoutMillis: 60_000,
}

const db = new Pool({
  ...connection,
  max: parseInt(process.env.POSTGRES_POOL_MAX ?? '4', 10),
  connectionTimeoutMillis: 5_000,
})

export const cronDb = new Pool({
  ...connection,
  max: parseInt(process.env.POSTGRES_CRON_POOL_MAX ?? '40', 10),
  connectionTimeoutMillis: 60_000,
})

cronDb.on('error', console.error)

export default db
