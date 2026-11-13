import { attachDatabasePool } from '@neon/functions'
import { Pool, types as pgTypes } from 'pg'
import TypeOverrides from 'pg/lib/type-overrides.js'

export type Runtime = {
  cachePool: Pool
  sourceDb: Pool
}

let runtime: Runtime | undefined

function timestampAsEpochSeconds(value: string): bigint {
  return BigInt(Math.floor(Date.parse(value) / 1000))
}

function sourcePoolTypes() {
  const types = new TypeOverrides(pgTypes)
  types.setTypeParser(1184, timestampAsEpochSeconds)
  return types
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be set explicitly`)
  return value
}

/** Create small pools lazily, after a request arrives. Imports never connect to a database. */
export function getRuntime(): Runtime {
  if (runtime) return runtime

  const databaseUrl = requiredEnv('DATABASE_URL')
  const cachePool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 30_000,
  })
  attachDatabasePool(cachePool)

  const useReplica = process.env.REST_CACHE_USE_SOURCE_REPLICA === 'true'
  const sourceUrl = useReplica ? requiredEnv('SOURCE_DATABASE_URL') : databaseUrl
  const sourceDb = new Pool({
    connectionString: sourceUrl,
    max: 4,
    idleTimeoutMillis: 30_000,
    types: sourcePoolTypes(),
  })
  attachDatabasePool(sourceDb)

  runtime = { cachePool, sourceDb }
  return runtime
}

/** A factory is exposed for local tools and handler tests that supply their own pools. */
export function setRuntimeForTests(value: Runtime | undefined): void {
  runtime = value
}
