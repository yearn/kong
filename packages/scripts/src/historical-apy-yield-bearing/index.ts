import { parseArgs } from 'util'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, http, parseAbi, type PublicClient, type Chain } from 'viem'
import { mainnet, optimism, gnosis, polygon, fantom, base, arbitrum } from 'viem/chains'
import { customChains } from 'lib/chains'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '.env') })

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  statement_timeout: 120000,
})

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'dry-run': { type: 'boolean', default: false },
  },
})

const dryRun = values['dry-run'] ?? false

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  100: gnosis,
  137: polygon,
  146: customChains.sonic,
  250: fantom,
  8453: base,
  42161: arbitrum,
  80094: customChains.bera,
  747474: customChains.katana,
}

function getRpcUrl(chainId: number): string {
  const url = process.env[`HTTP_ARCHIVE_${chainId}`]
  if (!url) throw new Error(`Missing RPC URL for chain ${chainId}. Set HTTP_ARCHIVE_${chainId} in .env`)
  return url
}

const clientCache = new Map<number, PublicClient>()
function getPublicClient(chainId: number): PublicClient {
  if (clientCache.has(chainId)) return clientCache.get(chainId)!
  const chain = CHAINS[chainId]
  if (!chain) throw new Error(`Unknown chain ID: ${chainId}`)
  const client = createPublicClient({ chain, transport: http(getRpcUrl(chainId)) })
  clientCache.set(chainId, client)
  return client
}

const pricePerShareAbi = parseAbi(['function pricePerShare() view returns (uint256)'])

interface NestedVault {
  chainId: number
  address: string
  asset: string
  decimals: number
  assetDecimals: number
  name: string | null
}

interface ApyEntry {
  blockTime: Date
  seriesTime: Date
  blockNumber: bigint
  components: Record<string, number>
}

interface OutputRow {
  chainId: number
  address: string
  label: string
  component: string
  value: number
  blockNumber: bigint
  blockTime: Date
  seriesTime: Date
}

function compoundAndAnnualizeDelta(
  beforePps: bigint, afterPps: bigint,
  beforeBlock: bigint, afterBlock: bigint,
  blocksPerDay: bigint
): number {
  const delta = Number(afterPps - beforePps) / Number(beforePps || 1n)
  const period = Number(afterBlock - beforeBlock) / Number(blocksPerDay)
  if (period <= 0) return 0
  return Math.pow(1 + delta, 365.2425 / period) - 1
}

const DB_BATCH_SIZE = 100

async function upsertRows(rows: OutputRow[], retry = true): Promise<{ success: number; failed: number }> {
  if (rows.length === 0) return { success: 0, failed: 0 }

  const paramValues: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let idx = 1

  for (const row of rows) {
    paramValues.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
    params.push(
      row.chainId, row.address, row.label, row.component,
      row.value, row.blockNumber.toString(), row.blockTime, row.seriesTime
    )
    idx += 8
  }

  const query = `
    INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${paramValues.join(', ')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET
      value = EXCLUDED.value,
      block_number = EXCLUDED.block_number,
      block_time = EXCLUDED.block_time
  `

  try {
    await pool.query(query, params)
    return { success: rows.length, failed: 0 }
  } catch (error) {
    if (retry) {
      console.warn(`  Batch upsert failed, retrying: ${error instanceof Error ? error.message : String(error)}`)
      return upsertRows(rows, false)
    }
    console.error(`  Batch upsert failed after retry: ${error instanceof Error ? error.message : String(error)}`)
    return { success: 0, failed: rows.length }
  }
}

async function main() {
  const startTime = Date.now()

  console.log('Connecting to database...')
  await pool.query('SELECT 1')
  console.log('Connected.')

  // 1. Find nested vaults (vault whose asset is also a vault)
  const nestedVaultsResult = await pool.query<NestedVault>(`
    SELECT
      t.chain_id as "chainId",
      t.address,
      t.defaults->>'asset' as asset,
      COALESCE((t.defaults->>'decimals')::int, 18) as decimals,
      COALESCE((t2.defaults->>'decimals')::int, 18) as "assetDecimals",
      COALESCE(t.defaults->>'name', s.snapshot->>'name') as name
    FROM thing t
    JOIN thing t2
      ON t.chain_id = t2.chain_id
      AND LOWER(t.defaults->>'asset') = LOWER(t2.address)
      AND t2.label = 'vault'
      AND t2.defaults->>'apiVersion' IS NOT NULL
    LEFT JOIN snapshot s ON t.chain_id = s.chain_id AND t.address = s.address
    WHERE t.label = 'vault'
    ORDER BY t.chain_id, t.address
  `)

  const nestedVaults = nestedVaultsResult.rows
  console.log(`Found ${nestedVaults.length} nested vault(s)\n`)

  if (nestedVaults.length === 0) {
    console.log('Nothing to do.')
    await pool.end()
    return
  }

  let totalProcessed = 0
  let totalErrors = 0
  let totalUpserted = 0
  let totalFailed = 0

  for (const vault of nestedVaults) {
    console.log(`--- ${vault.name || vault.address} (chain ${vault.chainId}) ---`)
    console.log(`  asset: ${vault.asset}`)

    // 2. Query all historical apy-bwd-delta-pps output entries
    const entriesResult = await pool.query(`
      SELECT block_time, block_number, component, value, series_time
      FROM output
      WHERE chain_id = $1 AND address = $2 AND label = 'apy-bwd-delta-pps'
      ORDER BY block_time, component
    `, [vault.chainId, vault.address])

    // Group by series_time
    const groups = new Map<string, ApyEntry>()
    for (const row of entriesResult.rows) {
      const key = row.series_time.toISOString()
      if (!groups.has(key)) {
        groups.set(key, {
          blockTime: row.block_time,
          seriesTime: row.series_time,
          blockNumber: BigInt(row.block_number),
          components: {},
        })
      }
      groups.get(key)!.components[row.component] = Number(row.value)
    }

    console.log(`  ${groups.size} historical entries`)
    if (groups.size === 0) continue

    const client = getPublicClient(vault.chainId)
    const scale = 10n ** BigInt(vault.assetDecimals)
    const assetAddress = vault.asset as `0x${string}`

    // PPS cache: blockNumber -> assetPps
    const ppsCache = new Map<string, bigint>()

    async function getAssetPps(blockNumber: bigint): Promise<bigint> {
      const key = blockNumber.toString()
      if (ppsCache.has(key)) return ppsCache.get(key)!
      const pps = await client.readContract({
        address: assetAddress,
        abi: pricePerShareAbi,
        functionName: 'pricePerShare',
        blockNumber,
      })
      ppsCache.set(key, pps as bigint)
      return pps as bigint
    }

    let processed = 0
    let errors = 0
    const allRows: OutputRow[] = []

    for (const [, entry] of groups) {
      const { components, blockTime, seriesTime, blockNumber } = entry

      try {
        const vaultPps = BigInt(Math.round(components.pricePerShare || 0))
        if (vaultPps === 0n) { processed++; continue }

        const weeklyPps = components.weeklyPricePerShare != null ? BigInt(Math.round(components.weeklyPricePerShare)) : undefined
        const monthlyPps = components.monthlyPricePerShare != null ? BigInt(Math.round(components.monthlyPricePerShare)) : undefined
        const inceptionPps = components.inceptionPricePerShare != null ? BigInt(Math.round(components.inceptionPricePerShare)) : undefined

        const weeklyBlock = components.weeklyBlockNumber != null ? BigInt(Math.round(components.weeklyBlockNumber)) : undefined
        const monthlyBlock = components.monthlyBlockNumber != null ? BigInt(Math.round(components.monthlyBlockNumber)) : undefined
        const inceptionBlock = components.inceptionBlockNumber != null ? BigInt(Math.round(components.inceptionBlockNumber)) : undefined

        // Read asset vault PPS at each block and compose
        const assetPps = await getAssetPps(blockNumber)
        const composedPps = vaultPps * assetPps / scale

        let composedWeeklyPps: bigint | undefined
        if (weeklyPps !== undefined && weeklyBlock !== undefined) {
          composedWeeklyPps = weeklyPps * (await getAssetPps(weeklyBlock)) / scale
        }

        let composedMonthlyPps: bigint | undefined
        if (monthlyPps !== undefined && monthlyBlock !== undefined) {
          composedMonthlyPps = monthlyPps * (await getAssetPps(monthlyBlock)) / scale
        }

        let composedInceptionPps: bigint | undefined
        if (inceptionPps !== undefined && inceptionBlock !== undefined) {
          composedInceptionPps = inceptionPps * (await getAssetPps(inceptionBlock)) / scale
        }

        // Compute APY deltas from composed PPS
        const blocksPerDay = weeklyBlock ? (blockNumber - weeklyBlock) / 7n : 7200n

        const weeklyNet = composedWeeklyPps !== undefined && weeklyBlock !== undefined
          ? compoundAndAnnualizeDelta(composedWeeklyPps, composedPps, weeklyBlock, blockNumber, blocksPerDay)
          : undefined

        const monthlyNet = composedMonthlyPps !== undefined && monthlyBlock !== undefined
          ? compoundAndAnnualizeDelta(composedMonthlyPps, composedPps, monthlyBlock, blockNumber, blocksPerDay)
          : undefined

        const inceptionNet = composedInceptionPps !== undefined && inceptionBlock !== undefined
          ? compoundAndAnnualizeDelta(composedInceptionPps, composedPps, inceptionBlock, blockNumber, blocksPerDay)
          : undefined

        // Pick net: mainnet prefers monthly, others prefer weekly
        const candidates = vault.chainId !== 1
          ? [weeklyNet, monthlyNet, inceptionNet]
          : [monthlyNet, weeklyNet, inceptionNet]
        const net = candidates.find(v => v !== undefined)

        if (net === undefined) { processed++; continue }

        // Scale grossApr proportionally to preserve fee relationship
        const oldNet = components.net || 0
        const oldGrossApr = components.grossApr || 0
        const grossApr = oldNet > 0 ? oldGrossApr * (net / oldNet) : 0

        // Build output rows
        const base = {
          chainId: vault.chainId,
          address: vault.address,
          label: 'apy-bwd-delta-pps',
          blockNumber,
          blockTime,
          seriesTime,
        }

        allRows.push(
          { ...base, component: 'net', value: net },
          { ...base, component: 'grossApr', value: grossApr },
          { ...base, component: 'pricePerShare', value: Number(composedPps) },
        )

        if (weeklyNet !== undefined) allRows.push({ ...base, component: 'weeklyNet', value: weeklyNet })
        if (composedWeeklyPps !== undefined) allRows.push({ ...base, component: 'weeklyPricePerShare', value: Number(composedWeeklyPps) })
        if (monthlyNet !== undefined) allRows.push({ ...base, component: 'monthlyNet', value: monthlyNet })
        if (composedMonthlyPps !== undefined) allRows.push({ ...base, component: 'monthlyPricePerShare', value: Number(composedMonthlyPps) })
        if (inceptionNet !== undefined) allRows.push({ ...base, component: 'inceptionNet', value: inceptionNet })
        if (composedInceptionPps !== undefined) allRows.push({ ...base, component: 'inceptionPricePerShare', value: Number(composedInceptionPps) })

        processed++
      } catch (err) {
        errors++
        const dateStr = blockTime.toISOString().split('T')[0]
        console.error(`  Error at ${dateStr} block ${blockNumber}:`, err instanceof Error ? err.message : String(err))
      }
    }

    console.log(`  Processed: ${processed}, Errors: ${errors}, Rows: ${allRows.length}`)
    totalProcessed += processed
    totalErrors += errors

    // Batch upsert
    if (!dryRun && allRows.length > 0) {
      const totalBatches = Math.ceil(allRows.length / DB_BATCH_SIZE)
      for (let i = 0; i < allRows.length; i += DB_BATCH_SIZE) {
        const batch = allRows.slice(i, i + DB_BATCH_SIZE)
        const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1
        if (batchNum === 1 || batchNum === totalBatches) {
          console.log(`  [${batchNum}/${totalBatches}] Upserting ${batch.length} rows...`)
        }
        const result = await upsertRows(batch)
        totalUpserted += result.success
        totalFailed += result.failed
      }
    } else if (dryRun) {
      console.log('  DRY RUN: skipping database writes')
    }

    // Clear PPS cache between vaults
    ppsCache.clear()
    console.log()
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('=== Summary ===')
  console.log(`Vaults:    ${nestedVaults.length}`)
  console.log(`Processed: ${totalProcessed}`)
  console.log(`Errors:    ${totalErrors}`)
  console.log(`Upserted:  ${totalUpserted}`)
  console.log(`Failed:    ${totalFailed}`)
  console.log(`Duration:  ${duration}s`)

  await pool.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
