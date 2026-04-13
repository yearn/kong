import 'lib/global'

import { computeApy, computeNetApr, extractFees__v3 } from 'ingest/abis/yearn/lib/apy'
import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { V3_ORACLE_ABI } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/abi'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import type { Output } from 'lib/types'
import { getAddress } from 'viem'

/**
 * Phase 1: Compute corrected apr-oracle outputs for vaults where getStrategyApr
 * returned 0 but getCurrentApr returns the real weighted-average APR.
 *
 * - Finds all affected apr-oracle rows (apr=0 in output table)
 * - Calls getCurrentApr/getStrategyApr on-chain for each row's original block
 * - Writes results to a temp table (output_temp_apr_oracle_backfill)
 * - Supports pause/resume: already-computed rows are skipped via the temp table
 *
 * Run upsert.ts to promote results to the output table.
 */

const TEMP_TABLE = 'output_temp_apr_oracle_backfill'
const CONCURRENCY = 10

function parseArgs(argv: string[]) {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts [--chain-id 1] [--dry-run]

Finds v3 vault apr-oracle output rows with apr=0 and re-queries the
oracle at each row's original block. Results go into ${TEMP_TABLE}.
Supports pause/resume — already-computed rows in the temp table are skipped.

Run upsert.ts to promote them to the output table.`)
    process.exit(0)
  }

  const chainId = getArg('--chain-id')

  return {
    chainId: chainId ? Number(chainId) : undefined,
    dryRun: hasArg('--dry-run'),
  }
}

type AffectedVault = {
  chainId: number
  address: `0x${string}`
  blockNumber: bigint
  blockTime: bigint
  seriesTime: Date
}

type TempOutput = Output & {
  seriesTime: Date
}

async function findAffectedVaults(chainId?: number): Promise<AffectedVault[]> {
  const params: number[] = []
  let chainFilter = ''

  if (chainId !== undefined) {
    params.push(chainId)
    chainFilter = `AND o.chain_id = $${params.length}`
  }

  const result = await db.query(`
    SELECT
      o.chain_id AS "chainId",
      o.address,
      o.block_number AS "blockNumber",
      EXTRACT(EPOCH FROM o.block_time)::bigint AS "blockTime",
      o.series_time AS "seriesTime"
    FROM output o
    JOIN thing t
      ON t.chain_id = o.chain_id
      AND t.address = o.address
      AND t.label = 'vault'
      AND COALESCE((t.defaults->>'v3')::boolean, false)
    WHERE o.label = 'apr-oracle'
      AND o.component = 'apr'
      AND o.value = 0
      ${chainFilter}
    ORDER BY o.chain_id, o.address, o.series_time
  `, params)

  return result.rows.map((row: {
    chainId: number
    address: string
    blockNumber: bigint
    blockTime: string
    seriesTime: Date
  }) => ({
    chainId: row.chainId,
    address: getAddress(row.address) as `0x${string}`,
    blockNumber: BigInt(row.blockNumber),
    blockTime: BigInt(row.blockTime),
    seriesTime: new Date(row.seriesTime),
  }))
}

async function readApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
) {
  let apr = 0

  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getCurrentApr',
      args: [address],
      blockNumber,
    })
    apr = Number(rawApr) / 1e18
  } catch {
    apr = 0
  }

  if (isNaN(apr) || !isFinite(apr)) {
    apr = 0
  }

  if (apr !== 0) {
    return apr
  }

  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })
    apr = Number(rawApr) / 1e18
  } catch {
    apr = 0
  }

  if (isNaN(apr) || !isFinite(apr)) {
    apr = 0
  }

  return apr
}

async function getAlreadyComputed(): Promise<Set<string>> {
  try {
    const result = await db.query(`
      SELECT DISTINCT chain_id, address, series_time FROM ${TEMP_TABLE}
    `)
    return new Set(result.rows.map((row: { chain_id: number; address: string; series_time: Date }) => (
      `${row.chain_id}:${row.address.toLowerCase()}:${new Date(row.series_time).toISOString()}`
    )))
  } catch {
    return new Set()
  }
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

async function insertTempBatch(rows: TempOutput[]) {
  if (rows.length === 0) return

  const values: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let idx = 1

  for (const row of rows) {
    const blockTime = new Date(Number(row.blockTime) * 1000)

    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
    params.push(
      row.chainId, row.address, row.label, row.component ?? '',
      row.value ?? 0, row.blockNumber.toString(), blockTime, row.seriesTime
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

async function computeVaultOracle(vault: AffectedVault): Promise<TempOutput[]> {
  const oracleConfig = getOracleConfig(vault.chainId)
  if (!oracleConfig) return []
  const blockNumber = vault.blockNumber

  const apr = await readApr(vault.chainId, vault.address, blockNumber, oracleConfig.address)
  if (apr === 0) return []

  const apy = computeApy(apr)

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(vault.chainId, vault.address, blockNumber)
    fees = await extractFees__v3(vault.chainId, vault.address, strategies, blockNumber)
  } catch (error) {
    console.warn(`  ⚠ fee fetch failed for ${vault.chainId}:${vault.address}:`, error)
  }

  const netApr = computeNetApr(apr, fees)
  const netApy = computeApy(netApr)
  const blockTime = vault.blockTime
  const baseRow = {
    chainId: vault.chainId,
    address: vault.address,
    blockNumber,
    blockTime,
    seriesTime: vault.seriesTime,
  }

  return [
    { ...baseRow, label: 'apr-oracle', component: 'apr', value: apr },
    { ...baseRow, label: 'apr-oracle', component: 'apy', value: apy },
    { ...baseRow, label: 'apr-oracle', component: 'netApr', value: netApr },
    { ...baseRow, label: 'apr-oracle', component: 'netApy', value: netApy },
  ]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startTime = Date.now()

  await rpcs.up()

  console.log(args.dryRun ? 'DRY RUN mode' : 'COMPUTE mode')
  if (args.chainId !== undefined) console.log(`chainId=${args.chainId}`)

  const allVaults = await findAffectedVaults(args.chainId)
  console.log(`found ${allVaults.length} apr-oracle rows with apr=0`)
  if (allVaults.length === 0) {
    await rpcs.down()
    await mq.down()
    await db.end()
    return
  }

  if (!args.dryRun) {
    await ensureTempTable()
  }

  // Filter out already-computed rows (pause/resume support)
  const alreadyComputed = args.dryRun ? new Set<string>() : await getAlreadyComputed()
  const vaults = allVaults.filter(v => !alreadyComputed.has(
    `${v.chainId}:${v.address.toLowerCase()}:${v.seriesTime.toISOString()}`
  ))
  if (alreadyComputed.size > 0) {
    console.log(`skipping ${allVaults.length - vaults.length} already-computed rows (resume)`)
  }
  console.log(`processing ${vaults.length} rows\n`)

  let fixed = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < vaults.length; i += CONCURRENCY) {
    const batch = vaults.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(batch.map(async (vault) => {
      const outputs = await computeVaultOracle(vault)
      return { vault, outputs }
    }))

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { vault, outputs } = result.value
        if (outputs.length > 0) {
          if (!args.dryRun) await insertTempBatch(outputs)
          fixed++
          const apr = outputs.find(o => o.component === 'apr')?.value ?? 0
          const netApr = outputs.find(o => o.component === 'netApr')?.value ?? 0
          console.log(`  fix ${vault.chainId}:${vault.address} apr=${apr.toFixed(6)} netApr=${netApr.toFixed(6)}`)
        } else {
          skipped++
          console.log(`  skip ${vault.chainId}:${vault.address} (getCurrentApr also returned 0)`)
        }
      } else {
        errors++
        console.error(`  error:`, result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }

    process.stdout.write(`\r  progress: ${Math.min(i + CONCURRENCY, vaults.length)}/${vaults.length} (${fixed} fixed, ${skipped} skipped, ${errors} errors)`)
  }

  console.log()

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('\n=== Summary ===')
  console.log(`Rows processed:   ${fixed + skipped + errors}`)
  console.log(`Fixed:            ${fixed}`)
  console.log(`Skipped (apr=0):  ${skipped}`)
  console.log(`Errors:           ${errors}`)
  console.log(`Duration:         ${duration}s`)

  if (!args.dryRun) {
    const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
    console.log(`Temp table:       ${count.rows[0].count} rows in ${TEMP_TABLE}`)
    console.log('\nRun upsert.ts to promote to the output table.')
  }

  await rpcs.down()
  await mq.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
