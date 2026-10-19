/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from 'zod'
import { strings } from 'lib'
import { StrideSchema, Thing, Snapshot } from 'lib/types'
import { Pool, PoolClient, types as pgTypes } from 'pg'
import { snakeToCamelCols } from 'lib/strings'

// Convert numeric (OID 1700) to float
pgTypes.setTypeParser(1700, 'text', parseFloat)

// Convert timestamptz (OID 1184) to seconds
pgTypes.setTypeParser(1184, (stringValue) => {
  return BigInt(Math.floor(Date.parse(stringValue) / 1000))
})

const db = new Pool({
  application_name: process.env.POSTGRES_APPLICATION_NAME || 'kong:ingest',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: (process.env.POSTGRES_PORT ?? 5432) as number,
  ssl: (process.env.POSTGRES_SSL ?? false)
    ? (process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED ?? true)
      ? true
      : { rejectUnauthorized: false }
    : false,
  database: process.env.POSTGRES_DATABASE ?? 'user',
  user: process.env.POSTGRES_USER ?? 'user',
  password: process.env.POSTGRES_PASSWORD ?? 'password',
  max: 40,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 60_000,
})

export default db

export async function query<T>(schema: z.ZodType<T>, sql: string, params: any[] = []) {
  return await _query<T>(schema)(sql, params)
}

export async function first<T>(schema: z.ZodType<T>, sql: string, params: any[] = []) {
  return (await _query<T>(schema)(sql, params))[0]
}

function _query<T>(schema: z.ZodType<T>) {
  return async function(sql: string, values: any[]) {
    const rows = (await db.query(sql, values)).rows
    const rowsInCamelCase = snakeToCamelCols(rows)
    return schema.array().parse(rowsInCamelCase)
  }
}

export async function some(query: string, params: any[] = [], client?: PoolClient) {
  return await count(query, params, client) > 0
}

export async function count(query: string, params: any[] = [], client?: PoolClient) {
  const result = await (client ?? db).query(query, params)
  return result.rows.length
}

export async function firstRow(query: string, params: any[] = [], client?: PoolClient) {
  const result = await (client ?? db).query(query, params)
  return result.rows[0]
}

export async function firstValue<T>(query: string, params: any[] = [], client?: PoolClient): Promise<T | undefined> {
  const result = await (client ?? db).query(query, params)
  return result.rows[0] ? result.rows[0][Object.keys(result.rows[0])[0]] as T : undefined
}

export async function getTravelledStrides(chainId: number, address: `0x${string}`, client?: PoolClient) {
  const result = await (client ?? db).query(
    `SELECT strides FROM evmlog_strides WHERE chain_id = $1 AND address = $2 ${client ? 'FOR UPDATE' : ''};`,
    [chainId, address]
  )
  const stridesJson = result.rows[0]?.strides
  return stridesJson ? StrideSchema.array().parse(JSON.parse(stridesJson)) : undefined
}

type Sparkline = Awaited<ReturnType<typeof querySparkline>>
type SparklineCacheEntry = { expires: number; result: Promise<Sparkline> }
type SparklineSeries = {
  boundary: number
  history: Map<string | undefined, SparklineCacheEntry>
  recent: Map<string | undefined, Promise<Sparkline>>
}
const sparklineCache = new Map<string, SparklineSeries>()
const SPARKLINE_CACHE_MAX_SERIES = 10_000
const SPARKLINE_WEEK = 7 * 86400
// time_bucket('7 day', timestamptz) uses Monday 2000-01-03 UTC as its origin.
const SPARKLINE_ORIGIN = 946857600
const configuredSparklineTtl = Number(process.env.SPARKLINE_CACHE_TTL_SECONDS || 3600)
const sparklineTtl = Number.isFinite(configuredSparklineTtl) && configuredSparklineTtl >= 0
  ? configuredSparklineTtl * 1000
  : 3_600_000

export function invalidateSparkline(chainId: number, address: string, label: string, blockTime?: bigint) {
  const key = JSON.stringify([chainId, address, label])
  const series = sparklineCache.get(key)
  if (!series) return
  if (blockTime === undefined || blockTime < BigInt(series.boundary)) {
    sparklineCache.delete(key)
  } else {
    // A current-week write must not evict completed historical buckets. Drop any
    // in-flight recent read so the next snapshot observes the committed write.
    series.recent.clear()
  }
}

export async function getSparkline(chainId: number, address: string, label: string, component?: string) {
  if (sparklineTtl === 0) return fetchSparkline(chainId, address, label, component)

  const key = JSON.stringify([chainId, address, label])
  const boundary = SPARKLINE_ORIGIN + Math.floor((Date.now() / 1000 - SPARKLINE_ORIGIN) / SPARKLINE_WEEK) * SPARKLINE_WEEK
  let series = sparklineCache.get(key)
  if (!series || series.boundary !== boundary) {
    sparklineCache.delete(key)
    if (sparklineCache.size >= SPARKLINE_CACHE_MAX_SERIES) {
      sparklineCache.delete(sparklineCache.keys().next().value!)
    }
    series = { boundary, history: new Map(), recent: new Map() }
    sparklineCache.set(key, series)
  }
  const components = series.history
  let entry = components.get(component)
  if (!entry || entry.expires <= Date.now()) {
    // Share in-flight queries too, including expensive sparse-series fallbacks.
    const pending = { expires: Infinity, result: fetchSparkline(chainId, address, label, component, boundary) }
    components.set(component, pending)
    pending.result.then(() => {
      pending.expires = Date.now() + sparklineTtl
    }, () => {
      if (components.get(component) === pending) components.delete(component)
    })
    entry = pending
  }
  const recentReads = series.recent
  let recent = recentReads.get(component)
  if (!recent) {
    const pending = querySparkline(chainId, address, label, component,
      'AND series_time >= to_timestamp($5::double precision) AND block_time >= to_timestamp($5::double precision)', boundary)
    recentReads.set(component, pending)
    const clear = () => { if (recentReads.get(component) === pending) recentReads.delete(component) }
    pending.then(clear, clear)
    recent = pending
  }
  // The current bucket also supplies live TVL: share concurrent reads, but never
  // retain it across snapshots. Historical rows and recent rows cannot overlap.
  const [history, current] = await Promise.all([entry.result, recent])
  return [...current, ...history].slice(0, 3).map(row => ({ ...row }))
}

async function fetchSparkline(chainId: number, address: string, label: string, component?: string, boundary?: number) {
  // series_time floor prunes hypertable chunks. If the recent window holds all 3
  // buckets they're the 3 most recent overall; fall back to a full scan when
  // fewer, so sparse/stale vaults keep their full series.
  const upper = boundary === undefined ? ''
    : 'AND block_time < to_timestamp($5::double precision)'
  const floor = boundary === undefined ? 'AND series_time >= now() - make_interval(days => 90)'
    : 'AND series_time >= to_timestamp($5::double precision) - INTERVAL \'13 weeks\''
  let rows = await querySparkline(chainId, address, label, component, `${floor} ${upper}`, boundary)
  if (rows.length < 3) rows = await querySparkline(chainId, address, label, component, upper, boundary)
  return rows
}

async function querySparkline(chainId: number, address: string, label: string, component: string | undefined, predicate: string, boundary?: number) {
  const sql = `
    SELECT
      CAST($1 AS int4) AS "chainId",
      CAST($2 AS text) AS address,
      CAST($3 AS text) AS label,
      CAST($4 AS text) AS component,
      time_bucket(CAST('7 day' AS interval), block_time) AS "blockTime",
      -- LAST does not skip nulls: without FILTER an outage row at the bucket's max
      -- block collapses close to 0
      COALESCE(LAST(NULLIF(value, 0), block_number) FILTER (WHERE value IS NOT NULL), 0) AS close
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = $3 AND (component = $4 OR $4 IS NULL)
      ${predicate}
    GROUP BY "blockTime"
    HAVING COUNT(value) > 0
    ORDER BY "blockTime" DESC
    LIMIT 3;
  `

  const params = boundary === undefined ? [chainId, address, label, component] : [chainId, address, label, component, boundary]
  const result = await db.query(sql, params)

  return z.object({
    chainId: z.number(),
    address: z.string(),
    label: z.string(),
    component: z.string().nullish(),
    blockTime: z.bigint({ coerce: true }),
    close: z.number()
  }).array().parse(result.rows)
}

export async function upsertThingDefaults(thing: Thing, client?: PoolClient) {
  // Single-statement upsert with an in-DB jsonb merge, replacing a prior
  // SELECT ... FOR UPDATE + read-modify-write that serialized concurrent ingest
  // on hot `thing` rows (the lock wait dominated the cost). `||` is a shallow
  // right-wins merge, matching the former { ...currentDefaults, ...thing.defaults },
  // and runs atomically under the row lock taken by ON CONFLICT, so there is no
  // lost-update race left to guard against.
  await (client ?? db).query(`
    INSERT INTO thing (chain_id, address, label, defaults)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (chain_id, address, label)
    DO UPDATE SET defaults = COALESCE(thing.defaults, '{}'::jsonb) || EXCLUDED.defaults
  `, [thing.chainId, thing.address, thing.label, thing.defaults])
}

export async function upsertSnapshotData(snapshot: Snapshot, client?: PoolClient) {
  // Object spread followed by JSON serialization removes explicit undefined
  // keys, but preserves omitted keys. Send those deletions alongside the patch.
  const removedSnapshotKeys = Object.keys(snapshot.snapshot).filter(key => snapshot.snapshot[key] === undefined)
  const removedHookKeys = Object.keys(snapshot.hook).filter(key => key !== 'meta' && snapshot.hook[key] === undefined)
  const { meta, ...hook } = snapshot.hook
  // meta is the only nested merge. Falsy/omitted meta preserves the old value.
  const metaPatch = meta ? { ...JSON.parse(JSON.stringify(meta)) } : null

  await (client ?? db).query(`
    INSERT INTO snapshot (chain_id, address, snapshot, hook, block_number, block_time)
    VALUES ($1, $2, $3::jsonb,
      $4::jsonb || CASE WHEN $8::jsonb IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('meta', $8::jsonb) END,
      $5, to_timestamp($6::double precision))
    ON CONFLICT (chain_id, address) DO UPDATE SET
      snapshot = (COALESCE(snapshot.snapshot, '{}'::jsonb) - $7::text[]) || EXCLUDED.snapshot,
      hook = ((COALESCE(snapshot.hook, '{}'::jsonb) - $9::text[]) || $4::jsonb)
        || CASE WHEN $8::jsonb IS NULL THEN '{}'::jsonb
          ELSE jsonb_build_object('meta',
            COALESCE(NULLIF(snapshot.hook->'meta', 'null'::jsonb), '{}'::jsonb) || $8::jsonb)
        END,
      block_number = EXCLUDED.block_number,
      block_time = EXCLUDED.block_time
  `, [snapshot.chainId, snapshot.address, snapshot.snapshot, hook,
    snapshot.blockNumber, snapshot.blockTime, removedSnapshotKeys, metaPatch, removedHookKeys])
}

export function toUpsertSql(table: string, pk: string, data: object, where?: string) {
  const timestampConversionExceptions = [ 'profit_max_unlock_time' ]

  const fields = Object.keys(data).map(key =>
    strings.camelToSnake(key)
  ) as string[]

  const columns = fields.join(', ')

  const values = fields.map((field, index) =>
    (field.endsWith('timestamp') || field.endsWith('time') && !timestampConversionExceptions.includes(field))
      ? `to_timestamp($${index + 1}::double precision)`
      : `$${index + 1}`
  ).join(', ')

  const updates = fields.map(field =>
    `${field} = EXCLUDED.${field}`
  ).join(', ')

  return `
    INSERT INTO ${table} (${columns})
    VALUES (${values})
    ON CONFLICT (${pk})
    DO UPDATE SET
      ${updates}
    ${where || ''};
  `
}
