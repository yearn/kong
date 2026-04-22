import 'lib/global'

import aprOracleHook from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import type { Output } from 'lib/types'
import { insertTempBatch, resetTempTable, type TempRow } from '../backfill-shared/tempTable'

/**
 * Recompute apr-oracle outputs for rows where the stored netApr is below the
 * new floor (grossApr / 2) — which also covers rows stored as negative.
 *
 * - Identifies (chain_id, address) + series_time pairs where netApr < apr / 2
 * - Replays the apr-oracle timeseries hook at each affected series_time
 * - Stages the full 4-row hook output (apr, apy, netApr, netApy) in the temp table
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

async function findAffected(): Promise<Affected[]> {
  const { rows } = await db.query(`
    SELECT n.chain_id, n.address, n.series_time
    FROM public.output n
    JOIN public.output g
      ON g.chain_id    = n.chain_id
     AND g.address     = n.address
     AND g.label       = 'apr-oracle'
     AND g.component   = 'apr'
     AND g.series_time = n.series_time
    WHERE n.label = 'apr-oracle'
      AND n.component = 'netApr'
      AND n.value < g.value / 2
    ORDER BY n.chain_id, n.address, n.series_time
  `)

  const grouped = new Map<string, Affected>()
  for (const r of rows) {
    const key = `${r.chain_id}:${r.address.toLowerCase()}`
    const seriesTime = BigInt(Math.floor(new Date(r.series_time).getTime() / 1000))
    const existing = grouped.get(key)
    if (existing) {
      existing.series_times.push(seriesTime)
    } else {
      grouped.set(key, { chain_id: r.chain_id, address: r.address, series_times: [seriesTime] })
    }
  }
  return [...grouped.values()]
}

function outputToTempRow(output: Output): TempRow | null {
  if (output.component == null || output.value == null) return null
  return {
    chain_id: output.chainId,
    address: output.address,
    label: output.label,
    component: output.component,
    value: output.value,
    block_number: output.blockNumber,
    block_time: new Date(Number(output.blockTime) * 1000),
    series_time: new Date(Number(output.blockTime) * 1000),
  }
}

async function replayVault(vault: Affected) {
  const staged: TempRow[] = []
  let errors = 0

  for (const seriesTime of vault.series_times) {
    try {
      const outputs = await aprOracleHook(vault.chain_id, vault.address, {
        abiPath: 'yearn/3/vault',
        chainId: vault.chain_id,
        address: vault.address,
        outputLabel: 'apr-oracle',
        blockTime: seriesTime,
      })
      for (const output of outputs) {
        const row = outputToTempRow(output)
        if (row) staged.push(row)
      }
    } catch (error) {
      errors++
      console.error(`  error ${vault.chain_id}:${vault.address} @ ${seriesTime}:`, error instanceof Error ? error.message : error)
    }
  }

  if (staged.length > 0) {
    const BATCH = 500
    for (let i = 0; i < staged.length; i += BATCH) {
      await insertTempBatch(TEMP_TABLE, staged.slice(i, i + BATCH))
    }
  }

  console.log(`  ${vault.chain_id}:${vault.address} series=${vault.series_times.length} staged=${staged.length} errors=${errors}`)
  return { staged: staged.length, errors }
}

async function main() {
  const startTime = Date.now()

  try {
    await rpcs.up()
    await resetTempTable(TEMP_TABLE)
    console.log(`reset temp table ${TEMP_TABLE}`)

    const affected = await findAffected()
    const totalSeries = affected.reduce((acc, v) => acc + v.series_times.length, 0)
    console.log(`${affected.length} vaults, ${totalSeries} series_time rows below floor\n`)

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
    console.log(`Vaults:    ${affected.length}`)
    console.log(`Series:    ${totalSeries}`)
    console.log(`Staged:    ${totalStaged}`)
    console.log(`Errors:    ${totalErrors}`)
    console.log(`Duration:  ${duration}s`)
  } finally {
    await rpcs.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
