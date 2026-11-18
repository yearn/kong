import 'lib/global'

import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import { readApr } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook'
import { computeApy, computeNetApr, extractFees__v3 } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { boundedEnvInt } from 'lib/env'
import { cache } from 'lib'
import {
  oracleObservationKey,
  toOracleTempRows,
  type OracleObservation,
  type OracleTempRow,
} from './observations'

/**
 * Compute corrected apr-oracle outputs for rows stored as apr=0
 * where the oracle actually reports a non-zero APR.
 *
 * - Finds distinct vaults with apr=0 rows in the output table
 * - Re-queries the oracle at each historical block for every timeseries row
 * - Writes corrected values to a temp table (output_temp_apr_oracle_backfill)
 *
 * Run upsert.ts to promote results to the output table.
 */

const TEMP_TABLE = 'output_temp_apr_oracle_backfill'
const CONCURRENCY = boundedEnvInt(process.env.RECOMPUTE_CONCURRENCY, 25, 100, 1)

function parseArgs(argv: string[]) {
  const hasArg = (flag: string) => argv.includes(flag)
  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:\n  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts\n\nFinds vaults with zero apr-oracle APR rows, then recomputes all their source observations once each.\nResults are staged in ${TEMP_TABLE}; reruns skip observations with all four components staged.\nSet RECOMPUTE_CONCURRENCY to tune the bounded RPC worker pool (default ${CONCURRENCY}, max 100).`)
    process.exit(0)
  }
}

type ObservationRow = {
  chain_id: number
  address: `0x${string}`
  block_number: string | bigint
  block_time: string | bigint
  series_time: string | bigint
}

async function fetchAffectedObservations(): Promise<OracleObservation[]> {
  // APR rows define each stored observation's source block and series key. The
  // component key makes that row unique per series_time, while the affected
  // vault set still includes every observation, not only its zero APR rows.
  const result = await db.query(`
    WITH affected_vaults AS (
      SELECT chain_id, address
      FROM public.output
      WHERE label = 'apr-oracle'
        AND component = 'apr'
        AND value = 0
      GROUP BY chain_id, address
    )
    SELECT DISTINCT
      o.chain_id,
      o.address,
      o.block_number,
      EXTRACT(EPOCH FROM o.block_time)::bigint AS block_time,
      EXTRACT(EPOCH FROM o.series_time)::bigint AS series_time
    FROM public.output o
    JOIN affected_vaults v
      ON v.chain_id = o.chain_id AND v.address = o.address
    WHERE o.label = 'apr-oracle'
      AND o.component = 'apr'
    ORDER BY 1, 2, 5, 3
  `)
  return result.rows.map((row: ObservationRow) => ({
    chain_id: row.chain_id,
    address: row.address,
    block_number: row.block_number,
    block_time: BigInt(row.block_time),
    series_time: BigInt(row.series_time),
  }))
}

async function ensureTempTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TEMP_TABLE} (
      chain_id     integer NOT NULL,
      address      text NOT NULL,
      label        text NOT NULL,
      component    text NOT NULL,
      value        numeric,
      block_number bigint NOT NULL,
      block_time   timestamptz NOT NULL,
      series_time  timestamptz NOT NULL,
      PRIMARY KEY  (chain_id, address, label, component, series_time)
    )
  `)
  const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
  console.log(`temp table ${TEMP_TABLE}: ${count.rows[0].count} existing rows`)
}

async function insertTempBatch(rows: OracleTempRow[]) {
  if (rows.length === 0) return

  const values: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let idx = 1

  for (const row of rows) {
    const blockTime = new Date(Number(row.block_time) * 1000)
    const seriesTime = new Date(Number(row.series_time) * 1000)

    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
    params.push(
      row.chain_id, row.address, row.label, row.component ?? '',
      row.value ?? 0, row.block_number.toString(), blockTime, seriesTime
    )
    idx += 8
  }

  await db.query(`
    INSERT INTO ${TEMP_TABLE} (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${values.join(', ')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET value = EXCLUDED.value, block_number = EXCLUDED.block_number, block_time = EXCLUDED.block_time
  `, params)
}

async function computeVaultOracle(row: OracleObservation): Promise<OracleTempRow[]> {
  const oracleConfig = getOracleConfig(row.chain_id)
  if (!oracleConfig) return []
  const blockNumber = BigInt(row.block_number)

  const apr = await readApr(row.chain_id, row.address, blockNumber, oracleConfig.address)
  // Intentionally falsy check: skip rows where the oracle still returns 0.
  if (!apr) return []

  const apy = computeApy(apr)

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(row.chain_id, row.address, blockNumber)
    fees = await extractFees__v3(row.chain_id, row.address, strategies, blockNumber)
  } catch (error) {
    console.warn(`  ⚠ fee fetch failed for ${row.chain_id}:${row.address}:`, error)
  }

  const netApr = computeNetApr(apr, fees)
  const netApy = computeApy(netApr)
  return toOracleTempRows(row, { apr, apy, netApr, netApy })
}

async function completedObservationKeys(): Promise<Set<string>> {
  const table = await db.query('SELECT to_regclass($1) AS table_name', [`public.${TEMP_TABLE}`])
  if (!table.rows[0]?.table_name) return new Set()

  const result = await db.query(`
    SELECT
      chain_id,
      address,
      block_number,
      EXTRACT(EPOCH FROM block_time)::bigint AS block_time,
      EXTRACT(EPOCH FROM series_time)::bigint AS series_time
    FROM ${TEMP_TABLE}
    WHERE label = 'apr-oracle'
    GROUP BY chain_id, address, block_number, block_time, series_time
    HAVING COUNT(DISTINCT component) FILTER (
      WHERE component IN ('apr', 'apy', 'netApr', 'netApy')
    ) = 4
  `)

  return new Set(result.rows.map((row: ObservationRow) => oracleObservationKey({
    chain_id: row.chain_id,
    address: row.address,
    block_number: row.block_number,
    block_time: BigInt(row.block_time),
    series_time: BigInt(row.series_time),
  })))
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const size = Math.min(CONCURRENCY, items.length)
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) await worker(items[cursor++])
  }))
}

async function closeResources() {
  const results = await Promise.allSettled([cache.down(), rpcs.down(), db.end()])
  for (const result of results) {
    if (result.status === 'rejected') console.error('Shutdown error:', result.reason)
  }
}

async function main() {
  parseArgs(process.argv.slice(2))
  const startTime = Date.now()

  try {
    await cache.up()
    await rpcs.up()

    const observations = await fetchAffectedObservations()
    if (observations.length === 0) {
      console.log('No zero apr-oracle observations found.')
      return
    }

    await ensureTempTable()
    const doneSet = await completedObservationKeys()
    const remaining = observations.filter(row => !doneSet.has(oracleObservationKey(row)))
    const vaults = new Set(observations.map(row => `${row.chain_id}:${row.address.toLowerCase()}`))
    console.log(`${observations.length} affected observations across ${vaults.size} vaults, ${doneSet.size} complete, ${remaining.length} remaining`)

    if (remaining.length === 0) {
      console.log('Nothing to compute.')
      return
    }

    let totalFixed = 0
    let totalSkipped = 0
    let totalErrors = 0
    let processed = 0

    await runPool(remaining, async observation => {
      try {
        const outputs = await computeVaultOracle(observation)
        if (outputs.length > 0) {
          await insertTempBatch(outputs)
          totalFixed += outputs.length
        } else {
          totalSkipped++
        }
      } catch (error) {
        totalErrors++
        console.error(`  error ${observation.chain_id}:${observation.address} block=${observation.block_number} series=${observation.series_time}:`, error instanceof Error ? error.message : error)
      }

      processed++
      if (processed % 25 === 0 || processed === remaining.length) {
        console.log(`[${processed}/${remaining.length}] outputs=${totalFixed} skipped=${totalSkipped} errors=${totalErrors}`)
      }
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('=== Summary ===')
    console.log(`Vaults:        ${vaults.size}`)
    console.log(`Observations:  ${remaining.length}`)
    console.log(`Output rows:   ${totalFixed}`)
    console.log(`Skipped:       ${totalSkipped}`)
    console.log(`Errors:        ${totalErrors}`)
    console.log(`Duration:      ${duration}s`)
  } finally {
    await closeResources()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
