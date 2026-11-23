import { types as pgTypes } from 'pg'
import { cloudflareEnv } from '../request-scope'

const WORKER_POOL_MAX = 4

pgTypes.setTypeParser(1184, (stringValue) => {
  return BigInt(Math.floor(Date.parse(stringValue) / 1000))
})

export const postgresConnection = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: (process.env.POSTGRES_PORT ?? 5432) as number,
  ssl: (process.env.POSTGRES_SSL ?? false) as boolean,
  database: process.env.POSTGRES_DATABASE ?? 'user',
  user: process.env.POSTGRES_USER ?? 'user',
  password: process.env.POSTGRES_PASSWORD ?? 'password',
  idleTimeoutMillis: 60_000,
}

export function postgresOptions(max: number) {
  const env = cloudflareEnv()
  if (!env) return { ...postgresConnection, max }
  const connection = env.HYPERDRIVE ? { connectionString: env.HYPERDRIVE.connectionString } : postgresConnection
  return { ...connection, max: Math.min(max, WORKER_POOL_MAX) }
}
