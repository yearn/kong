import 'lib/global'

import aprOracleHookErc4626 from 'ingest/abis/erc4626/timeseries/apr-oracle/hook'
import aprOracleHookV3 from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import type { Output } from 'lib/types'
import { insertTempBatch, resetTempTable, type TempRow } from '../backfill-shared/tempTable'

/**
 * Backfill the apr-oracle currentApr components (issue #437) into historical
 * rows. The hook now reads the oracle's getCurrentApr(vault) as its own
 * timeseries components; existing rows predate that read and need to be filled.
 *
 * - Finds every apr-oracle data point (anchored on the `apr` component) that
 *   does not yet have a `currentApr` row at the same series_time.
 * - Replays the real apr-oracle hook at each point so the staged values match
 *   production exactly. v3 vaults replay yearn/3/vault (currentApr/currentApy +
 *   currentNetApr/currentNetApy); erc4626 vaults replay erc4626 (currentApr/
 *   currentApy only — net needs the v3 fee path). getCurrentApr reverts stage
 *   nothing for that point.
 * - Stages only the current* components (apr/apy/netApr/netApy are untouched).
 *
 * Run upsert.ts to promote results to the output table.
 */

const TEMP_TABLE = 'output_temp_apr_oracle_current_backfill'
const CONCURRENCY = 150

const STAGED_V3 = new Set(['currentApr', 'currentApy', 'currentNetApr', 'currentNetApy'])
const STAGED_ERC4626 = new Set(['currentApr', 'currentApy'])

type Kind = 'v3' | 'erc4626'

type Affected = {
  chain_id: number
  address: `0x${string}`
  kind: Kind
  series_times: bigint[]
}

// v3 vs erc4626 mirror the config/abis.yaml `things` filters: v3 vaults are
// yearn/3/vault (apiVersion >= 3, non-ydaemon origin), erc4626 vaults carry
// erc4626=true and are not yearn. The kind picks which hook to replay, which in
// turn decides whether currentNet* components exist.
function classifyVault(defaults: Record<string, unknown> | null): Kind | undefined {
  if (!defaults) return undefined
  const truthy = (v: unknown) => v === true || v === 'true'
  if (truthy(defaults.erc4626) && !truthy(defaults.yearn)) return 'erc4626'
  const apiVersion = typeof defaults.apiVersion === 'string' ? defaults.apiVersion : undefined
  const major = apiVersion ? parseInt(apiVersion.split('.')[0], 10) : NaN
  if (Number.isFinite(major) && major >= 3 && defaults.origin !== 'ydaemon') return 'v3'
  return undefined
}

async function loadVaultKinds(): Promise<Map<string, Kind>> {
  const { rows } = await db.query(`
    SELECT chain_id, address, defaults FROM thing WHERE label = 'vault'
  `)
  const kinds = new Map<string, Kind>()
  for (const r of rows) {
    const kind = classifyVault(r.defaults)
    if (kind) kinds.set(`${r.chain_id}:${r.address.toLowerCase()}`, kind)
  }
  return kinds
}

async function findAffected(kinds: Map<string, Kind>): Promise<{ affected: Affected[], skippedUnknown: number }> {
  console.log('querying apr-oracle points missing currentApr...')
  const queryStart = Date.now()
  // Anchor on the `apr` component: every apr-oracle point has exactly one apr
  // row, so this yields one row per (vault, series_time) point. NOT EXISTS keeps
  // the backfill idempotent — points already carrying currentApr are skipped.
  const { rows } = await db.query(`
    SELECT o.chain_id, o.address, EXTRACT(EPOCH FROM o.series_time)::bigint AS series_time_epoch
    FROM public.output o
    WHERE o.label = 'apr-oracle' AND o.component = 'apr'
      AND NOT EXISTS (
        SELECT 1 FROM public.output c
        WHERE c.chain_id = o.chain_id AND c.address = o.address
          AND c.label = 'apr-oracle' AND c.component = 'currentApr'
          AND c.series_time = o.series_time
      )
    ORDER BY o.chain_id, o.address, o.series_time
  `)
  console.log(`query returned ${rows.length} points in ${((Date.now() - queryStart) / 1000).toFixed(2)}s`)

  const grouped = new Map<string, Affected>()
  let skippedUnknown = 0

  for (const r of rows) {
    const vaultKey = `${r.chain_id}:${r.address.toLowerCase()}`
    const kind = kinds.get(vaultKey)
    if (!kind) {
      skippedUnknown++
      continue
    }
    const seriesTime = BigInt(r.series_time_epoch)
    const existing = grouped.get(vaultKey)
    if (existing) {
      existing.series_times.push(seriesTime)
    } else {
      grouped.set(vaultKey, { chain_id: r.chain_id, address: r.address, kind, series_times: [seriesTime] })
    }
  }

  return { affected: [...grouped.values()], skippedUnknown }
}

function outputToTempRow(output: Output): TempRow | null {
  if (output.component == null || output.value == null) return null
  // The hook echoes the blockTime we pass in, so series_time/block_time both
  // become the series-bucket timestamp — matching the temp-table primary key
  // (chain_id, address, label, component, series_time) used on upsert.
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

async function replayVault(vault: Affected) {
  const hook = vault.kind === 'v3' ? aprOracleHookV3 : aprOracleHookErc4626
  const abiPath = vault.kind === 'v3' ? 'yearn/3/vault' : 'erc4626'
  const staged = vault.kind === 'v3' ? STAGED_V3 : STAGED_ERC4626

  const rows: TempRow[] = []
  let errors = 0
  const total = vault.series_times.length
  const tag = `${vault.chain_id}:${vault.address} (${vault.kind})`
  const logEvery = Math.max(1, Math.floor(total / 10))

  console.log(`  ${tag} start series=${total}`)

  for (let i = 0; i < total; i++) {
    const seriesTime = vault.series_times[i]
    try {
      const outputs = await hook(vault.chain_id, vault.address, {
        abiPath,
        chainId: vault.chain_id,
        address: vault.address,
        outputLabel: 'apr-oracle',
        blockTime: seriesTime,
      })
      for (const output of outputs) {
        if (!output.component || !staged.has(output.component)) continue
        const row = outputToTempRow(output)
        if (row) rows.push(row)
      }
    } catch (error) {
      errors++
      console.error(`  ${tag} error @ ${seriesTime}:`, error instanceof Error ? error.message : error)
    }

    if ((i + 1) % logEvery === 0 || i + 1 === total) {
      console.log(`  ${tag} progress ${i + 1}/${total} staged=${rows.length} errors=${errors}`)
    }
  }

  if (rows.length > 0) {
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      await insertTempBatch(TEMP_TABLE, rows.slice(i, i + BATCH))
    }
  }

  console.log(`  ${tag} done series=${total} staged=${rows.length} errors=${errors}`)
  return { staged: rows.length, errors }
}

async function main() {
  const startTime = Date.now()

  try {
    await rpcs.up()
    await resetTempTable(TEMP_TABLE)
    console.log(`reset temp table ${TEMP_TABLE}`)

    const kinds = await loadVaultKinds()
    console.log(`classified ${kinds.size} vault things`)

    const { affected, skippedUnknown } = await findAffected(kinds)
    const uniquePoints = affected.reduce((acc, v) => acc + v.series_times.length, 0)
    const v3Count = affected.filter(v => v.kind === 'v3').length
    const erc4626Count = affected.filter(v => v.kind === 'erc4626').length
    console.log(`To replay: ${uniquePoints} points across ${affected.length} vaults (v3=${v3Count} erc4626=${erc4626Count})`)
    console.log(`Skipped (unclassified vault): ${skippedUnknown} points\n`)

    if (affected.length === 0) {
      console.log('nothing to backfill.')
      return
    }

    let totalStaged = 0
    let totalErrors = 0
    let completedVaults = 0

    for (let i = 0; i < affected.length; i += CONCURRENCY) {
      const batch = affected.slice(i, i + CONCURRENCY)
      const batchStart = Date.now()
      console.log(`\nbatch ${i / CONCURRENCY + 1}/${Math.ceil(affected.length / CONCURRENCY)}: vaults ${i + 1}-${Math.min(i + CONCURRENCY, affected.length)}/${affected.length}`)
      const results = await Promise.all(batch.map(replayVault))
      for (const r of results) {
        totalStaged += r.staged
        totalErrors += r.errors
      }
      completedVaults += batch.length
      const elapsed = (Date.now() - startTime) / 1000
      const rate = completedVaults / elapsed
      const remaining = affected.length - completedVaults
      const eta = rate > 0 ? (remaining / rate).toFixed(0) : '?'
      console.log(`batch done in ${((Date.now() - batchStart) / 1000).toFixed(2)}s | progress ${completedVaults}/${affected.length} vaults | staged=${totalStaged} errors=${totalErrors} | eta=${eta}s`)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('\n=== Summary ===')
    console.log(`Points to backfill:  ${uniquePoints}`)
    console.log(`Vaults replayed:     ${affected.length} (v3=${v3Count} erc4626=${erc4626Count})`)
    console.log(`Output rows staged:  ${totalStaged}`)
    console.log(`Skipped points:      ${skippedUnknown} (unclassified vault)`)
    console.log(`Errors:              ${totalErrors}`)
    console.log(`Duration:            ${duration}s`)
  } finally {
    await rpcs.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
