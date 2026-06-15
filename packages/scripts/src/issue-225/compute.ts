import 'lib/global'

import computeApy from 'ingest/abis/erc4626/timeseries/apy/hook'
import computeOracleApr from 'ingest/abis/erc4626/timeseries/apr-oracle/hook'
import db from 'ingest/db'
import type { Data } from 'ingest/extract/timeseries'
import { rpcs } from 'ingest/rpcs'
import { endOfDay } from 'lib/dates'
import type { Output } from 'lib/types'
import { getAddress } from 'viem'
import { resetTempTable, insertTempBatch, type TempRow } from '../backfill-shared/tempTable'

const TEMP_TABLE = 'output_temp_fapy_oracle'
const GRID_LABEL = 'apy-bwd-delta-pps'
const CONCURRENCY = 25

type HookFn = (chainId: number, address: `0x${string}`, data: Data) => Promise<Output[]>

type LabelKey = 'apy' | 'oracle'

const LABELS: Record<LabelKey, { outputLabel: string, compute: HookFn }> = {
  apy: { outputLabel: 'apy-bwd-delta-pps', compute: computeApy },
  oracle: { outputLabel: 'apr-oracle', compute: computeOracleApr },
}

function parseArgs(argv: string[]) {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/issue-225/compute.ts --vaults chainId:0xABC,... [--labels apy,oracle] [--start 2025-01-01] [--end 2026-04-09] [--dry-run]

Recomputes historical apy (apy-bwd-delta-pps) and historical oracle apy (apr-oracle)
for plain erc4626 vaults affected by the share-vs-asset decimals fix (issue #225).
Reuses the live erc4626 timeseries hooks -- no duplicated compute. The daily grid
is taken from each vault's existing '${GRID_LABEL}' output rows. Results go into
${TEMP_TABLE} (reset on each run); run upsert.ts to promote them to the output table.`)
    process.exit(0)
  }

  const vaultsArg = getArg('--vaults')
  if (!vaultsArg) {
    console.error('Required: --vaults chainId:0xABC,chainId:0xDEF,...')
    process.exit(1)
  }

  const vaults = vaultsArg.split(',').map(pair => {
    const [chainIdStr, address] = pair.split(':')
    return { chainId: Number(chainIdStr), address: getAddress(address as `0x${string}`) }
  })

  const labelsArg = getArg('--labels')
  const labels = (labelsArg ? labelsArg.split(',') : ['apy', 'oracle']).map(l => l.trim())
  for (const label of labels) {
    if (!(label in LABELS)) {
      console.error(`Unknown label '${label}'. Valid: ${Object.keys(LABELS).join(', ')}`)
      process.exit(1)
    }
  }

  return {
    vaults,
    labels: labels as LabelKey[],
    start: getArg('--start'),
    end: getArg('--end'),
    dryRun: hasArg('--dry-run'),
  }
}

async function getGridBlockTimes(
  chainId: number, address: string, start?: string, end?: string
): Promise<bigint[]> {
  const params: (number | string | Date)[] = [chainId, address]
  let timeFilter = ''

  if (start) {
    params.push(new Date(start))
    timeFilter += ` AND series_time >= $${params.length}`
  }
  if (end) {
    params.push(new Date(end))
    timeFilter += ` AND series_time <= $${params.length}`
  }

  const result = await db.query(`
    SELECT DISTINCT EXTRACT(EPOCH FROM block_time)::bigint AS block_time_epoch
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = '${GRID_LABEL}' ${timeFilter}
    ORDER BY block_time_epoch
  `, params)

  return result.rows.map((row: { block_time_epoch: string }) => BigInt(row.block_time_epoch))
}

function toTempRows(outputs: Output[]): TempRow[] {
  // series_time must be derived exactly as the load path does (load/index.ts:
  // `series_time: endOfDay(output.blockTime)`) so the upsert's ON CONFLICT keys
  // match existing rows and overwrite them instead of inserting duplicates.
  return outputs.map(output => ({
    chain_id: output.chainId,
    address: output.address,
    label: output.label,
    component: output.component ?? '',
    value: Number(output.value ?? 0),
    block_number: output.blockNumber,
    block_time: new Date(Number(output.blockTime) * 1000),
    series_time: new Date(Number(endOfDay(output.blockTime)) * 1000),
  }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startTime = Date.now()

  await rpcs.up()

  console.log(args.dryRun ? 'DRY RUN mode' : 'COMPUTE mode')
  console.log(`Vaults: ${args.vaults.length}`)
  console.log(`Labels: ${args.labels.join(', ')}`)
  if (args.start) console.log(`Start: ${args.start}`)
  if (args.end) console.log(`End: ${args.end}`)

  if (!args.dryRun) await resetTempTable(TEMP_TABLE)

  let totalEntries = 0
  let totalOutputs = 0
  let totalErrors = 0

  for (const vault of args.vaults) {
    const { chainId, address } = vault
    console.log(`\n--- ${chainId}:${address} ---`)

    const grid = await getGridBlockTimes(chainId, address, args.start, args.end)
    console.log(`  ${grid.length} grid points (from '${GRID_LABEL}')`)
    if (grid.length === 0) {
      console.log(`  skip: no '${GRID_LABEL}' history -- run a normal fanout to backfill this vault`)
      continue
    }
    totalEntries += grid.length

    let processed = 0
    let errors = 0

    for (let i = 0; i < grid.length; i += CONCURRENCY) {
      const batch = grid.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (blockTime) => {
        const outputs: Output[] = []
        for (const key of args.labels) {
          const { outputLabel, compute } = LABELS[key]
          outputs.push(...await compute(chainId, address, {
            abiPath: 'erc4626', chainId, address, outputLabel, blockTime,
          }))
        }
        return outputs
      }))

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.length > 0) {
            if (!args.dryRun) await insertTempBatch(TEMP_TABLE, toTempRows(result.value))
            totalOutputs += result.value.length
          }
          processed++
        } else {
          errors++
          totalErrors++
          console.error('  Error:', result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }

      process.stdout.write(`\r  ${processed}/${grid.length} processed, ${errors} errors`)
    }

    console.log()
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('\n=== Summary ===')
  console.log(`Vaults:     ${args.vaults.length}`)
  console.log(`Grid pts:   ${totalEntries}`)
  console.log(`Outputs:    ${totalOutputs}`)
  console.log(`Errors:     ${totalErrors}`)
  console.log(`Duration:   ${duration}s`)

  if (!args.dryRun) {
    const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
    console.log(`Temp table: ${count.rows[0].count} rows in ${TEMP_TABLE}`)
    console.log('\nRun upsert.ts to promote to the output table.')
  }

  await rpcs.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
