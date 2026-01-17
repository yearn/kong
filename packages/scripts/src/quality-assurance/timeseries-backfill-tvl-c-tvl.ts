import 'lib/global'
import { config } from 'dotenv'
import { parseArgs } from 'util'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env from same directory BEFORE importing modules that use env vars
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '.env') })

import { Thing, ThingSchema } from 'lib/types'
import { estimateHeight, getBlock } from 'lib/blocks'
import { normalize } from 'lib/math'
import { rpcs } from 'lib/rpcs'
import { first } from 'ingest/db'
import db from 'ingest/db'
import { _compute } from 'ingest/abis/yearn/lib/tvl'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    'price-tolerance': { type: 'string', short: 't', default: '0' },
    'gap-concurrency': { type: 'string', short: 'g', default: '5' },
    'vault-concurrency': { type: 'string', short: 'v', default: '1' },
  },
})

interface GapInput {
  generated: string
  summary: {
    totalVaults: number
    vaultsWithGaps: number
    totalGaps: number
    totalGapDays: number
  }
  gaps: Array<{
    chainId: number
    address: string
    label: string
    dataPoints: number
    zeroPoints: number
    nonZeroPoints: number
    totalGapDays: number
    backfilled?: boolean
    gaps: Array<{
      type: 'missing' | 'zero' | 'incomplete'
      from: string
      to: string
      days: number
    }>
  }>
}

interface PriceFailure {
  chainId: number
  address: string
  date: string
  blockNumber: string
}

interface BackfillResult {
  updated: number
  skippedNoVault: number
  skippedNoTotalAssets: number
  skippedPriceFailed: number
  priceFailures: PriceFailure[]
}

interface DateTask {
  dateStr: string
  vault: Thing
  chainId: number
  address: string
}

function generateGapDates(from: string, to: string): string[] {
  const dates: string[] = []
  const startDate = new Date(from + 'T00:00:00Z')
  const endDate = new Date(to + 'T00:00:00Z')

  const current = new Date(startDate)
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }
  return dates
}

async function getVault(chainId: number, address: string): Promise<Thing | null> {
  return first<Thing>(
    ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, 'vault']
  )
}

async function updateOutput(
  chainId: number,
  address: string,
  component: string,
  seriesTime: Date,
  value: number
): Promise<boolean> {
  const result = await db.query(
    `UPDATE output SET value = $1
     WHERE chain_id = $2 AND address = $3 AND label = 'tvl-c' AND component = $4
     AND series_time::date = $5::date`,
    [value, chainId, address, component, seriesTime]
  )
  return (result.rowCount ?? 0) > 0
}

async function processDate(
  task: DateTask,
  priceTolerance: number,
  dryRun: boolean,
  result: BackfillResult
): Promise<void> {
  const { dateStr, vault, chainId, address } = task

  // Check required vault defaults before calling _compute
  if (!vault.defaults?.apiVersion || !vault.defaults?.asset || vault.defaults?.yearn !== true) {
    console.warn(`  Skipping ${dateStr}: vault missing required defaults (apiVersion, asset, yearn)`)
    return
  }

  const blockTime = BigInt(Math.floor(new Date(dateStr + 'T23:59:59Z').getTime() / 1000))

  let blockNumber: bigint
  try {
    const estimate = await estimateHeight(chainId, blockTime)
    const block = await getBlock(chainId, estimate)
    blockNumber = block.number
  } catch (error) {
    console.error(`  Failed to estimate block for ${dateStr}:`, error)
    return
  }

  try {
    const computed = await _compute(vault, blockNumber, false, priceTolerance)

    if (computed.priceUsd === 0) {
      result.skippedPriceFailed++
      result.priceFailures.push({
        chainId,
        address,
        date: dateStr,
        blockNumber: blockNumber.toString(),
      })
      return
    }

    if (computed.totalAssets === undefined || computed.totalAssets === null) {
      result.skippedNoTotalAssets++
      return
    }

    const normalizedTotalAssets = normalize(computed.totalAssets, vault.defaults.decimals as number) || 0

    if (dryRun) {
      console.log(`  [DRY RUN] ${dateStr}: block=${blockNumber}, totalAssets=${normalizedTotalAssets.toFixed(2)}, price=${computed.priceUsd.toFixed(6)}, tvl=${computed.tvl.toFixed(2)}`)
    } else {
      const seriesTime = new Date(dateStr + 'T23:59:59Z')
      await updateOutput(chainId, address, 'tvl', seriesTime, computed.tvl)
      await updateOutput(chainId, address, 'priceUsd', seriesTime, computed.priceUsd)
      await updateOutput(chainId, address, 'totalAssets', seriesTime, normalizedTotalAssets)
    }

    result.updated++
  } catch (error) {
    console.error(`  Error computing tvl for ${dateStr}:`, error)
  }
}

// Simple mutex for synchronized file writes
let writeLock = Promise.resolve()
async function syncWriteFile(path: string, data: string): Promise<void> {
  writeLock = writeLock.then(() => {
    writeFileSync(path, data)
  })
  await writeLock
}

async function main() {
  if (!values.input) {
    console.error('Usage: bun packages/scripts/src/quality-assurance/timeseries-backfill-tvl-c-tvl.ts --input <gaps.json> [--output <report.json>] [--dry-run] [--price-tolerance 86400] [--gap-concurrency 5] [--vault-concurrency 1]')
    process.exit(1)
  }

  // Initialize RPC pool
  console.error('Initializing RPC clients...')
  await rpcs.up()

  const priceTolerance = Number(values['price-tolerance'])
  const dryRun = values['dry-run'] ?? false
  const gapConcurrency = Number(values['gap-concurrency'])
  const vaultConcurrency = Number(values['vault-concurrency'])

  console.error(`Reading input file: ${values.input}`)
  const inputData: GapInput = JSON.parse(readFileSync(values.input, 'utf-8'))

  const tvlGaps = inputData.gaps.filter((g) => g.label === 'tvl-c')
  if (tvlGaps.length === 0) {
    console.error('No tvl-c gaps found in input file.')
    process.exit(0)
  }

  console.error(`Found ${tvlGaps.length} vault(s) with tvl-c gaps`)
  console.error(`Price tolerance: ${priceTolerance} seconds (${(priceTolerance / 3600).toFixed(1)} hours)`)
  console.error(`Gap concurrency: ${gapConcurrency}, Vault concurrency: ${vaultConcurrency}`)
  if (dryRun) {
    console.error('DRY RUN MODE - no changes will be made')
  }

  const result: BackfillResult = {
    updated: 0,
    skippedNoVault: 0,
    skippedNoTotalAssets: 0,
    skippedPriceFailed: 0,
    priceFailures: [],
  }

  async function processVault(vaultGap: GapInput['gaps'][number]): Promise<void> {
    const { chainId, address, gaps } = vaultGap
    console.error(`\nProcessing ${chainId}:${address}`)

    if (vaultGap.backfilled) {
      console.error('  Already backfilled, skipping')
      return
    }

    const vault = await getVault(chainId, address)
    if (!vault) {
      console.error('  Vault not found in thing table, skipping')
      result.skippedNoVault++
      return
    }

    for (const gap of gaps) {
      if (gap.type !== 'zero' && gap.type !== 'incomplete') {
        console.error(`  Skipping ${gap.type} gap (${gap.from} to ${gap.to})`)
        continue
      }

      const gapDates = generateGapDates(gap.from, gap.to)
      console.error(`  Processing ${gap.type} gap: ${gap.from} to ${gap.to} (${gapDates.length} days)`)

      // Process dates in batches with gap concurrency
      for (let i = 0; i < gapDates.length; i += gapConcurrency) {
        const batch = gapDates.slice(i, i + gapConcurrency)
        const tasks: DateTask[] = batch.map(dateStr => ({
          dateStr,
          vault,
          chainId,
          address,
        }))

        await Promise.all(tasks.map(task => processDate(task, priceTolerance, dryRun, result)))

        const processed = Math.min(i + gapConcurrency, gapDates.length)
        if (gapDates.length > 10 && (processed % 50 === 0 || processed === gapDates.length)) {
          console.error(`    Processed ${processed}/${gapDates.length} days...`)
        }
      }
    }

    // Mark vault as backfilled and save progress
    if (!dryRun) {
      vaultGap.backfilled = true
      await syncWriteFile(values.input, JSON.stringify(inputData, null, 2))
      console.error('  Marked as backfilled')
    }
  }

  // Process vaults in batches with vault concurrency
  for (let i = 0; i < tvlGaps.length; i += vaultConcurrency) {
    const batch = tvlGaps.slice(i, i + vaultConcurrency)
    await Promise.all(batch.map(vaultGap => processVault(vaultGap)))
  }

  console.error('\n=== Summary ===')
  console.error(`Total days updated: ${result.updated}`)
  console.error(`Skipped (vault not found): ${result.skippedNoVault}`)
  console.error(`Skipped (no totalAssets from RPC): ${result.skippedNoTotalAssets}`)
  console.error(`Skipped (price = 0): ${result.skippedPriceFailed}`)

  if (result.priceFailures.length > 0) {
    console.error(`\nPrice failures (${result.priceFailures.length}):`)
    for (const pf of result.priceFailures.slice(0, 10)) {
      console.error(`  ${pf.chainId}:${pf.address} ${pf.date} block=${pf.blockNumber}`)
    }
    if (result.priceFailures.length > 10) {
      console.error(`  ... and ${result.priceFailures.length - 10} more`)
    }
  }

  if (values.output) {
    writeFileSync(values.output, JSON.stringify(result, null, 2))
    console.error(`\nReport written to ${values.output}`)
  }

  if (dryRun) {
    console.error('\nDRY RUN - no actual changes were made')
  }

  await rpcs.down()
  process.exit(0)
}

main().catch(async (error) => {
  console.error('Fatal error:', error)
  await rpcs.down()
  process.exit(1)
})
