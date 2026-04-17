import 'lib/global'

import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import { readApr } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook'
import { computeApy, computeNetApr, extractFees__v3 } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'

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
const CONCURRENCY = 10000

async function fetchAffectedVaults(): Promise<{ chain_id: number; address: `0x${string}` }[]> {
  const result = await db.query(`
    SELECT DISTINCT ON (address) chain_id, address
    FROM public.output
    WHERE label = 'apr-oracle' AND value = 0
  `)
  return result.rows
}

type AffectedRow = {
  chain_id: number
  address: `0x${string}`
  block_number: string
  block_time: bigint
  series_time: bigint
}

type TempRow = {
  chain_id: number
  address: `0x${string}`
  label: string
  component: string
  value: number
  block_number: bigint
  block_time: bigint
  series_time: bigint
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

async function insertTempBatch(rows: TempRow[]) {
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

async function computeVaultOracle(row: AffectedRow): Promise<TempRow[]> {
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
  const base = {
    chain_id: row.chain_id,
    address: row.address,
    block_number: blockNumber,
    block_time: row.block_time,
    series_time: row.series_time,
  }

  return [
    { ...base, label: 'apr-oracle', component: 'apr', value: apr },
    { ...base, label: 'apr-oracle', component: 'apy', value: apy },
    { ...base, label: 'apr-oracle', component: 'netApr', value: netApr },
    { ...base, label: 'apr-oracle', component: 'netApy', value: netApy },
  ]
}

async function main() {
  const startTime = Date.now()

  await rpcs.up()

  const vaults = await fetchAffectedVaults()

  if (vaults.length === 0) {
    await rpcs.down()
    await db.end()
    return
  }

  await ensureTempTable()

  const alreadyDone = await db.query(`
    SELECT DISTINCT chain_id, address FROM ${TEMP_TABLE}
  `)
  const doneSet = new Set(alreadyDone.rows.map((r: { chain_id: number; address: string }) =>
    `${r.chain_id}:${r.address.toLowerCase()}`
  ))

  const remaining = vaults.filter(v => !doneSet.has(`${v.chain_id}:${v.address.toLowerCase()}`))
  console.log(`${vaults.length} affected vaults, ${doneSet.size} already computed, ${remaining.length} remaining\n`)

  if (remaining.length === 0) {
    await rpcs.down()
    await db.end()
    return
  }

  let totalFixed = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async (vault) => {
      const vaultTimeseries = await db.query(`
        SELECT * FROM output
        WHERE label = 'apr-oracle' AND address = $1 AND chain_id = $2
      `, [vault.address, vault.chain_id])

      let fixed = 0
      let skipped = 0
      let errors = 0
      for (const row of vaultTimeseries.rows) {
        try {
          const outputs = await computeVaultOracle(row)
          if (outputs.length > 0) {
            await insertTempBatch(outputs)
            fixed += outputs.length
          } else {
            skipped++
          }
        } catch (error) {
          errors++
          console.error(`  error ${vault.chain_id}:${vault.address} block=${row.block_number}:`, error instanceof Error ? error.message : error)
        }
      }

      totalFixed += fixed
      totalSkipped += skipped
      totalErrors += errors
      console.log(`  ${vault.chain_id}:${vault.address} rows=${vaultTimeseries.rows.length} fixed=${fixed} skipped=${skipped} errors=${errors}`)
    }))

    const done = Math.min(i + CONCURRENCY, remaining.length)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[${done}/${remaining.length}] ${elapsed}s elapsed | fixed=${totalFixed} skipped=${totalSkipped} errors=${totalErrors}\n`)
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('=== Summary ===')
  console.log(`Vaults:    ${remaining.length}`)
  console.log(`Fixed:     ${totalFixed}`)
  console.log(`Skipped:   ${totalSkipped}`)
  console.log(`Errors:    ${totalErrors}`)
  console.log(`Duration:  ${duration}s`)

  await rpcs.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
