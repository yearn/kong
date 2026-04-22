import 'lib/global'

import { computeApy } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'

/**
 * Compute corrected apr-oracle outputs for rows where netApr/netApy were
 * stored as a negative number because fees exceeded the gross APR.
 *
 * Yearn's accountant caps management + performance fees at 50% of profit, so
 * the lower bound for net APR is grossApr / 2. The hook now enforces that
 * floor, and this backfill rewrites existing negative rows to the same value.
 *
 * - Joins each negative netApr/netApy row to its same-series_time gross `apr`
 * - Writes `gross / 2` (or `computeApy(gross / 2)` for netApy) into a temp table
 * - Skips rows with no matching gross apr row or where gross is negative
 *
 * Run upsert.ts to promote results to the output table.
 */

const TEMP_TABLE = 'output_temp_netapr_floor_backfill'

type NegativeRow = {
  chain_id: number
  address: `0x${string}`
  component: 'netApr' | 'netApy'
  value: string
  block_number: string
  block_time: Date
  series_time: Date
  gross_apr: string | null
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

async function insertBatch(rows: {
  chain_id: number
  address: string
  component: string
  value: number
  block_number: string
  block_time: Date
  series_time: Date
}[]) {
  if (rows.length === 0) return

  const values: string[] = []
  const params: (string | number | Date)[] = []
  let idx = 1

  for (const row of rows) {
    values.push(`($${idx}, $${idx + 1}, 'apr-oracle', $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`)
    params.push(row.chain_id, row.address, row.component, row.value, row.block_number, row.block_time, row.series_time)
    idx += 7
  }

  await db.query(`
    INSERT INTO ${TEMP_TABLE} (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${values.join(', ')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET value = EXCLUDED.value, block_number = EXCLUDED.block_number, block_time = EXCLUDED.block_time
  `, params)
}

async function main() {
  const startTime = Date.now()

  await ensureTempTable()

  const preview = await db.query(`
    SELECT chain_id, address, component, count(*) AS rows, min(value) AS min_value
    FROM public.output
    WHERE label = 'apr-oracle'
      AND component IN ('netApr', 'netApy')
      AND value < 0
    GROUP BY chain_id, address, component
    ORDER BY chain_id, address, component
  `)
  console.log(`found negative rows across ${preview.rows.length} (vault, component) pairs`)
  for (const row of preview.rows) {
    console.log(`  ${row.chain_id}:${row.address} ${row.component} rows=${row.rows} min=${row.min_value}`)
  }

  if (preview.rows.length === 0) {
    console.log('nothing to backfill.')
    await db.end()
    return
  }

  const { rows }: { rows: NegativeRow[] } = await db.query(`
    SELECT
      n.chain_id,
      n.address,
      n.component,
      n.value,
      n.block_number,
      n.block_time,
      n.series_time,
      g.value AS gross_apr
    FROM public.output n
    LEFT JOIN public.output g
      ON g.chain_id    = n.chain_id
     AND g.address     = n.address
     AND g.label       = 'apr-oracle'
     AND g.component   = 'apr'
     AND g.series_time = n.series_time
    WHERE n.label = 'apr-oracle'
      AND n.component IN ('netApr', 'netApy')
      AND n.value < 0
    ORDER BY n.chain_id, n.address, n.series_time, n.component
  `)

  const staged: Parameters<typeof insertBatch>[0] = []
  let skippedNoGross = 0
  let skippedNegativeGross = 0

  for (const row of rows) {
    if (row.gross_apr === null) {
      skippedNoGross++
      continue
    }
    const gross = Number(row.gross_apr)
    if (gross < 0) {
      skippedNegativeGross++
      continue
    }
    const floor = gross / 2
    const value = row.component === 'netApr' ? floor : computeApy(floor)
    staged.push({
      chain_id: row.chain_id,
      address: row.address,
      component: row.component,
      value,
      block_number: row.block_number,
      block_time: row.block_time,
      series_time: row.series_time,
    })
  }

  const BATCH = 500
  for (let i = 0; i < staged.length; i += BATCH) {
    await insertBatch(staged.slice(i, i + BATCH))
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('=== Summary ===')
  console.log(`Negative rows found:     ${rows.length}`)
  console.log(`Staged (gross >= 0):     ${staged.length}`)
  console.log(`Skipped (no gross row):  ${skippedNoGross}`)
  console.log(`Skipped (gross < 0):     ${skippedNegativeGross}`)
  console.log(`Duration:                ${duration}s`)

  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
