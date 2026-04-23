import 'lib/global'

import aprOracleHook from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import type { Output } from 'lib/types'
import { insertTempBatch, resetTempTable, type TempRow } from '../backfill-shared/tempTable'

/**
 * Recompute apr-oracle netApr/netApy outputs for rows where either is below
 * the new floor (grossApr / 2). Covers rows stored as negative.
 *
 * - Identifies (chain_id, address) + series_time pairs where netApr OR netApy
 *   is below the corresponding gross apr / 2
 * - Replays the apr-oracle timeseries hook at each affected series_time
 * - Stages only the recomputed netApr and netApy rows (apr / apy are untouched)
 * - Temp table is truncated at the start of every run to avoid stale staged rows
 *
 * Run upsert.ts to promote results to the output table.
 */

const TEMP_TABLE = 'output_temp_netapr_floor_backfill'
const CONCURRENCY = 8

type Affected = {
  chain_id: number
  address: `0x${string}`
  series_times: bigint[]
}

type FindAffectedResult = {
  affected: Affected[]
  totalBelowFloor: number
  skippedNoGross: number
  skippedGrossNegative: number
  stageable: number
}

async function findAffected(): Promise<FindAffectedResult> {
  // Count every netApr and netApy row below floor (both are derived from the
  // same replay). LEFT JOIN so we can distinguish "no matching gross row"
  // from "gross is negative"; both are skipped.
  const { rows } = await db.query(`
    SELECT
      n.chain_id,
      n.address,
      n.component,
      EXTRACT(EPOCH FROM n.series_time)::bigint AS series_time_epoch,
      g.value AS gross_value
    FROM public.output n
    LEFT JOIN public.output g
      ON g.chain_id    = n.chain_id
     AND g.address     = n.address
     AND g.label       = 'apr-oracle'
     AND g.component   = 'apr'
     AND g.series_time = n.series_time
    WHERE n.label = 'apr-oracle'
      AND n.component IN ('netApr', 'netApy')
      AND (g.value IS NULL OR n.value < g.value / 2)
    ORDER BY n.chain_id, n.address, n.series_time, n.component
  `)

  let skippedNoGross = 0
  let skippedGrossNegative = 0
  // Dedupe by (chain, address, series_time): one replay covers both netApr and netApy.
  const seen = new Set<string>()
  const grouped = new Map<string, Affected>()

  for (const r of rows) {
    if (r.gross_value === null || r.gross_value === undefined) {
      skippedNoGross++
      continue
    }
    if (Number(r.gross_value) < 0) {
      skippedGrossNegative++
      continue
    }
    const dedupeKey = `${r.chain_id}:${r.address.toLowerCase()}:${r.series_time_epoch}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const vaultKey = `${r.chain_id}:${r.address.toLowerCase()}`
    const seriesTime = BigInt(r.series_time_epoch)
    const existing = grouped.get(vaultKey)
    if (existing) {
      existing.series_times.push(seriesTime)
    } else {
      grouped.set(vaultKey, { chain_id: r.chain_id, address: r.address, series_times: [seriesTime] })
    }
  }

  const stageable = rows.length - skippedNoGross - skippedGrossNegative

  return {
    affected: [...grouped.values()],
    totalBelowFloor: rows.length,
    skippedNoGross,
    skippedGrossNegative,
    stageable,
  }
}

function outputToTempRow(output: Output): TempRow | null {
  if (output.component == null || output.value == null) return null
  // We pass the original series_time epoch in as `blockTime`, so the hook echoes it
  // back and series_time/block_time are both the series-bucket timestamp. This matches
  // the primary key (chain_id, address, label, component, series_time) used on upsert.
  const seriesDate = new Date(Number(output.blockTime) * 1000)
  return {
    chain_id: output.chainId,
    address: output.address,
    label: output.label,
    component: output.component,
    value: output.value,
    block_number: output.blockNumber,
    block_time: seriesDate,
    series_time: seriesDate,
  }
}

// Only the net components are affected by the floor change. Staging the
// companion `apr` / `apy` rows would rewrite their block_time and value
// unnecessarily, so we filter here.
const STAGED_COMPONENTS = new Set(['netApr', 'netApy'])

async function replayVault(vault: Affected) {
  const staged: TempRow[] = []
  let errors = 0
  const total = vault.series_times.length
  const tag = `${vault.chain_id}:${vault.address}`
  const logEvery = Math.max(1, Math.floor(total / 10))

  console.log(`  ${tag} start series=${total}`)

  for (let i = 0; i < total; i++) {
    const seriesTime = vault.series_times[i]
    try {
      const outputs = await aprOracleHook(vault.chain_id, vault.address, {
        abiPath: 'yearn/3/vault',
        chainId: vault.chain_id,
        address: vault.address,
        outputLabel: 'apr-oracle',
        blockTime: seriesTime,
      })
      for (const output of outputs) {
        if (!output.component || !STAGED_COMPONENTS.has(output.component)) continue
        const row = outputToTempRow(output)
        if (row) staged.push(row)
      }
    } catch (error) {
      errors++
      console.error(`  ${tag} error @ ${seriesTime}:`, error instanceof Error ? error.message : error)
    }

    if ((i + 1) % logEvery === 0 || i + 1 === total) {
      console.log(`  ${tag} progress ${i + 1}/${total} staged=${staged.length} errors=${errors}`)
    }
  }

  if (staged.length > 0) {
    const BATCH = 500
    for (let i = 0; i < staged.length; i += BATCH) {
      await insertTempBatch(TEMP_TABLE, staged.slice(i, i + BATCH))
    }
  }

  console.log(`  ${tag} done series=${total} staged=${staged.length} errors=${errors}`)
  return { staged: staged.length, errors }
}

async function main() {
  const startTime = Date.now()

  try {
    await rpcs.up()
    await resetTempTable(TEMP_TABLE)
    console.log(`reset temp table ${TEMP_TABLE}`)

    const { affected, totalBelowFloor, skippedNoGross, skippedGrossNegative, stageable } = await findAffected()
    const uniqueSeriesTimes = affected.reduce((acc, v) => acc + v.series_times.length, 0)
    console.log(`Below-floor rows found: ${totalBelowFloor}  (netApr + netApy)`)
    console.log(`Skipped (no gross row): ${skippedNoGross}`)
    console.log(`Skipped (gross < 0): ${skippedGrossNegative}`)
    console.log(`To replay: ${uniqueSeriesTimes} unique series_times across ${affected.length} vaults\n`)

    if (affected.length === 0) {
      console.log('nothing to backfill.')
      return
    }

    let totalStaged = 0
    let totalErrors = 0

    for (let i = 0; i < affected.length; i += CONCURRENCY) {
      const batch = affected.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(replayVault))
      for (const r of results) {
        totalStaged += r.staged
        totalErrors += r.errors
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('\n=== Summary ===')
    console.log(`Below-floor rows found:  ${totalBelowFloor}`)
    console.log(`Staged (gross >= 0):     ${stageable}`)
    console.log(`Skipped (no gross row):  ${skippedNoGross}`)
    console.log(`Skipped (gross < 0):     ${skippedGrossNegative}`)
    console.log(`Output rows staged:      ${totalStaged}  (${uniqueSeriesTimes} replays x 2 net components)`)
    console.log(`Vaults replayed:         ${affected.length}`)
    console.log(`Errors:                  ${totalErrors}`)
    console.log(`Duration:                ${duration}s`)
  } finally {
    await rpcs.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
