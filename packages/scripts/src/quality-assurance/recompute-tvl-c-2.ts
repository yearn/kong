import { z } from 'zod'
import { parseArgs } from 'util'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getAddress, createPublicClient, http, type PublicClient, type Chain } from 'viem'
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
  statement_timeout: 60000,
})

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    update: { type: 'string' },
    vaults: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
})

const dryRun = values['dry-run'] ?? false

if (!values.update || !['totalAssets', 'tvls'].includes(values.update)) {
  console.error('Required: --update [totalAssets|tvls]')
  process.exit(1)
}

if (!values.vaults) {
  console.error('Required: --vaults chainId:0x123,chainId:0x456,...')
  process.exit(1)
}

const DAY_SECONDS = 86400

const nowTimestamp = Math.floor(Date.now() / 1000)
const yesterdayStart = nowTimestamp - (nowTimestamp % DAY_SECONDS) - DAY_SECONDS

const startTimestamp = values.start
  ? Math.floor(new Date(values.start).getTime() / 1000)
  : Math.floor(new Date('2024-01-01').getTime() / 1000)

const endTimestamp = values.end
  ? Math.floor(new Date(values.end).getTime() / 1000)
  : yesterdayStart

const AssetSchema = z.object({
  chainId: z.number(),
  address: z.string(),
})

const VaultSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  name: z.string(),
  decimals: z.number({ coerce: true }),
  asset: AssetSchema.nullable(),
  inceptTime: z.string().nullable(),
  inceptBlock: z.string().nullable(),
})

const VaultsResponseSchema = z.object({
  data: z.object({
    vaults: z.array(VaultSchema),
  }),
})

async function fetchVaultMetadata(vaultKeys: { chainId: number; address: string }[]) {
  const query = `
    query Vaults {
      vaults {
        chainId
        address
        name
        decimals
        asset {
          chainId
          address
        }
        inceptTime
        inceptBlock
      }
    }
  `

  const response = await fetch('https://kong.yearn.fi/api/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`GraphQL request failed: HTTP ${response.status}`)
  }

  const data = await response.json()
  const allVaults = VaultsResponseSchema.parse(data).data.vaults

  const result: typeof allVaults = []
  for (const key of vaultKeys) {
    const found = allVaults.find(
      v => v.chainId === key.chainId && getAddress(v.address) === key.address
    )
    if (!found) {
      throw new Error(`Vault not found: ${key.chainId}:${key.address}`)
    }
    result.push(found)
  }

  return result
}

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
  if (!url) {
    throw new Error(`Missing RPC URL for chain ${chainId}. Set HTTP_ARCHIVE_${chainId} in .env`)
  }
  return url
}

function getPublicClient(chainId: number): PublicClient {
  const chain = CHAINS[chainId]
  if (!chain) {
    throw new Error(`Unknown chain ID: ${chainId}`)
  }
  const url = getRpcUrl(chainId)
  return createPublicClient({
    chain,
    transport: http(url),
  })
}

function buildDayWindow(start: number, end: number): number[] {
  const days: number[] = []
  // Normalize to last second of each day (23:59:59 UTC)
  let dayEnd = start - (start % DAY_SECONDS) + DAY_SECONDS - 1
  while (dayEnd <= end + DAY_SECONDS - 1) {
    days.push(dayEnd)
    dayEnd += DAY_SECONDS
  }
  return days
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  100: 'xdai',
  137: 'polygon',
  146: 'sonic',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  80094: 'berachain',
  747474: 'katana',
}

const DEFILLAMA_API = process.env.DEFILLAMA_API ?? 'https://coins.llama.fi'

async function getBlockForTimestamp(
  chainId: number,
  timestamp: number
): Promise<bigint> {
  const chainName = CHAIN_NAMES[chainId]
  if (!chainName) {
    throw new Error(`Unknown chain ID for DefiLlama: ${chainId}`)
  }

  const url = `${DEFILLAMA_API}/block/${chainName}/${timestamp}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`DefiLlama block API failed: HTTP ${response.status}`)
  }

  const data = await response.json() as { height: number; timestamp: number }
  return BigInt(data.height)
}

interface DefillamaPriceResponse {
  coins: Record<string, {
    price: number
    symbol: string
    timestamp: number
    confidence?: number
  }>
}

async function fetchHistoricalPrices(
  coinIds: string[],
  timestamp: number
): Promise<DefillamaPriceResponse | null> {
  const coins = coinIds.join(',')
  const url = `${DEFILLAMA_API}/prices/historical/${timestamp}/${coins}`
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`  Failed to fetch prices: HTTP ${response.status}`)
      return null
    }
    return await response.json() as DefillamaPriceResponse
  } catch (error) {
    console.error(`  Failed to fetch prices: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const totalAssetsAbi = [
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

interface MulticallItem {
  vault: { chainId: number; address: string; name: string; decimals: number }
  address: `0x${string}`
}

interface MulticallResult {
  vault: { chainId: number; address: string; name: string; decimals: number }
  result: bigint | null
  day: number
  blockNumber: bigint
  error?: string
}

function normalize(value: bigint, decimals: number, precision: number = 18): number {
  const factor = BigInt(10 ** precision)
  return Number(value * factor / BigInt(10 ** decimals)) / Number(factor)
}

interface OutputRow {
  chainId: number
  address: string
  label: string
  component: string
  value: string
  blockNumber: bigint
  blockTime: Date
  seriesTime: Date
}

interface PriceRow {
  chainId: number
  address: string
  priceUsd: number
  priceSource: string
  blockNumber: bigint
  blockTime: Date
}

const DB_BATCH_SIZE = 100

async function upsertOutputAndPrices(
  outputRows: OutputRow[],
  priceRows: PriceRow[],
  retry = true
): Promise<{ outputSuccess: number; outputFailed: number; priceSuccess: number; priceFailed: number }> {
  if (outputRows.length === 0 && priceRows.length === 0) {
    return { outputSuccess: 0, outputFailed: 0, priceSuccess: 0, priceFailed: 0 }
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Upsert output rows
    if (outputRows.length > 0) {
      const outputValues: string[] = []
      const outputParams: (string | number | bigint | Date)[] = []
      let paramIndex = 1

      for (const row of outputRows) {
        outputValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`)
        outputParams.push(
          row.chainId,
          row.address,
          row.label,
          row.component,
          row.value,
          row.blockNumber.toString(),
          row.blockTime,
          row.seriesTime
        )
        paramIndex += 8
      }

      const outputQuery = `
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        VALUES ${outputValues.join(', ')}
        ON CONFLICT (chain_id, address, label, component, series_time)
        DO UPDATE SET
          value = EXCLUDED.value,
          block_number = EXCLUDED.block_number,
          block_time = EXCLUDED.block_time
      `
      await client.query(outputQuery, outputParams)
    }

    // Upsert price rows
    if (priceRows.length > 0) {
      const priceValues: string[] = []
      const priceParams: (string | number | bigint | Date)[] = []
      let paramIndex = 1

      for (const row of priceRows) {
        priceValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`)
        priceParams.push(
          row.chainId,
          row.address,
          row.priceUsd,
          row.priceSource,
          row.blockNumber.toString(),
          row.blockTime
        )
        paramIndex += 6
      }

      const priceQuery = `
        INSERT INTO price (chain_id, address, price_usd, price_source, block_number, block_time)
        VALUES ${priceValues.join(', ')}
        ON CONFLICT (chain_id, address, block_number)
        DO UPDATE SET
          price_usd = EXCLUDED.price_usd,
          price_source = EXCLUDED.price_source,
          block_time = EXCLUDED.block_time
      `
      await client.query(priceQuery, priceParams)
    }

    await client.query('COMMIT')
    return {
      outputSuccess: outputRows.length,
      outputFailed: 0,
      priceSuccess: priceRows.length,
      priceFailed: 0,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (retry) {
      console.warn(`  Batch upsert failed, retrying once: ${error instanceof Error ? error.message : String(error)}`)
      client.release()
      return upsertOutputAndPrices(outputRows, priceRows, false)
    }
    console.error(`  Batch upsert failed after retry: ${error instanceof Error ? error.message : String(error)}`)
    return {
      outputSuccess: 0,
      outputFailed: outputRows.length,
      priceSuccess: 0,
      priceFailed: priceRows.length,
    }
  } finally {
    client.release()
  }
}

async function upsertTotalAssets(rows: OutputRow[], retry = true): Promise<{ success: number; failed: number }> {
  if (rows.length === 0) return { success: 0, failed: 0 }

  const values: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let paramIndex = 1

  for (const row of rows) {
    values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`)
    params.push(
      row.chainId,
      row.address,
      row.label,
      row.component,
      row.value,
      row.blockNumber.toString(),
      row.blockTime,
      row.seriesTime
    )
    paramIndex += 8
  }

  const query = `
    INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${values.join(', ')}
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
      console.warn(`  Batch upsert failed, retrying once: ${error instanceof Error ? error.message : String(error)}`)
      return upsertTotalAssets(rows, false)
    }
    console.error(`  Batch upsert failed after retry: ${error instanceof Error ? error.message : String(error)}`)
    return { success: 0, failed: rows.length }
  }
}

async function main() {
  const startTime = Date.now()

  // Parse and dedupe requested vaults from input
  const requestedVaultsRaw = values.vaults!.split(',').map(pair => {
    const [chainIdStr, address] = pair.split(':')
    return { chainId: Number(chainIdStr), address: getAddress(address) }
  })
  const requestedVaultMap = new Map<string, typeof requestedVaultsRaw[number]>()
  for (const v of requestedVaultsRaw) {
    requestedVaultMap.set(`${v.chainId}:${v.address}`, v)
  }
  const requestedVaults = Array.from(requestedVaultMap.values())
  if (requestedVaultsRaw.length !== requestedVaults.length) {
    console.warn(`Input had ${requestedVaultsRaw.length - requestedVaults.length} duplicate vault(s)`)
  }

  console.log('Fetching vault metadata...')
  const fetchedVaults = await fetchVaultMetadata(requestedVaults)

  // Deduplicate vaults by chainId:address
  const vaultMap = new Map<string, typeof fetchedVaults[number]>()
  for (const vault of fetchedVaults) {
    const key = `${vault.chainId}:${vault.address}`
    if (vaultMap.has(key)) {
      console.warn(`Duplicate vault found: ${key}`)
    }
    vaultMap.set(key, vault)
  }
  const vaults = Array.from(vaultMap.values())

  console.log(`Found ${fetchedVaults.length} vaults${fetchedVaults.length !== vaults.length ? ` (${fetchedVaults.length - vaults.length} duplicates removed)` : ''}`)

  const window = buildDayWindow(startTimestamp, endTimestamp)
  console.log(`\nDay window: ${window.length} days`)
  console.log(`  Start: ${new Date(startTimestamp * 1000).toISOString().split('T')[0]}`)
  console.log(`  End: ${new Date(endTimestamp * 1000).toISOString().split('T')[0]}`)

  if (values.update === 'totalAssets') {
    const multicalls = new Map<number, MulticallItem[]>()

    for (const vault of vaults) {
      if (!vault.inceptTime) {
        console.warn(`Skipping vault ${vault.chainId}:${vault.address} - no inceptTime`)
        continue
      }

      const inceptTime = Number(vault.inceptTime)

      for (const day of window) {
        if (day >= inceptTime) {
          if (!multicalls.has(day)) {
            multicalls.set(day, [])
          }
          multicalls.get(day)!.push({
            vault: { chainId: vault.chainId, address: vault.address, name: vault.name, decimals: vault.decimals },
            address: vault.address as `0x${string}`,
          })
        }
      }
    }

    console.log(`\nMulticalls prepared for ${multicalls.size} days`)

    const multicallResults = new Map<number, MulticallResult[]>()
    const BATCH_SIZE = 50

    const chainClients = new Map<number, PublicClient>()
    const blockCache = new Map<string, bigint>()

    const sortedDays = [...multicalls.keys()].sort((a, b) => a - b)
    let processedDays = 0

    for (const day of sortedDays) {
      processedDays++
      const dateStr = new Date(day * 1000).toISOString().split('T')[0]
      const callsForDay = multicalls.get(day)!

      if (processedDays % 10 === 1 || processedDays === sortedDays.length) {
        console.log(`\n[${processedDays}/${sortedDays.length}] ${dateStr} - ${callsForDay.length} calls`)
      }

      const callsByChain = new Map<number, MulticallItem[]>()
      for (const call of callsForDay) {
        const chainId = call.vault.chainId
        if (!callsByChain.has(chainId)) {
          callsByChain.set(chainId, [])
        }
        callsByChain.get(chainId)!.push(call)
      }

      const dayResults: MulticallResult[] = []

      for (const [chainId, chainCalls] of callsByChain) {
        if (!chainClients.has(chainId)) {
          chainClients.set(chainId, getPublicClient(chainId))
        }
        const client = chainClients.get(chainId)!

        const blockCacheKey = `${chainId}:${day}`
        let blockNumber: bigint
        if (blockCache.has(blockCacheKey)) {
          blockNumber = blockCache.get(blockCacheKey)!
        } else {
          blockNumber = await getBlockForTimestamp(chainId, day)
          blockCache.set(blockCacheKey, blockNumber)
        }

        for (let batch = 0; batch < Math.ceil(chainCalls.length / BATCH_SIZE); batch++) {
          const batchCalls = chainCalls.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE)

          const contracts = batchCalls.map(call => ({
            address: call.address,
            abi: totalAssetsAbi,
            functionName: 'totalAssets' as const,
          }))

          try {
            const results = await client.multicall({
              contracts,
              blockNumber,
            })

            for (let i = 0; i < batchCalls.length; i++) {
              const call = batchCalls[i]
              const result = results[i]

              if (result.status === 'success') {
                dayResults.push({
                  vault: call.vault,
                  result: result.result as bigint,
                  day,
                  blockNumber,
                })
              } else {
                dayResults.push({
                  vault: call.vault,
                  result: null,
                  day,
                  blockNumber,
                  error: result.error?.message ?? 'Unknown error',
                })
              }
            }
          } catch (error) {
            console.error(`  Batch failed for chain ${chainId}:`, error instanceof Error ? error.message : String(error))
            for (const call of batchCalls) {
              dayResults.push({
                vault: call.vault,
                result: null,
                day,
                blockNumber,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      }

      multicallResults.set(day, dayResults)
    }

    console.log('\n--- Multicall Results Stats ---')
    let totalCalls = 0
    let successfulCalls = 0
    let failedCalls = 0

    for (const [, results] of multicallResults) {
      for (const result of results) {
        totalCalls++
        if (result.result !== null) {
          successfulCalls++
        } else {
          failedCalls++
        }
      }
    }

    console.log('Days processed:', multicallResults.size)
    console.log('Total calls:', totalCalls)
    console.log('Successful:', successfulCalls)
    console.log('Failed:', failedCalls)
    console.log('Success rate:', ((successfulCalls / totalCalls) * 100).toFixed(2) + '%')

    // Prepare rows for database upsert
    const rowsToUpsert: OutputRow[] = []
    for (const [day, results] of multicallResults) {
      for (const result of results) {
        if (result.result !== null) {
          const normalizedValue = normalize(result.result, result.vault.decimals)
          rowsToUpsert.push({
            chainId: result.vault.chainId,
            address: result.vault.address,
            label: 'tvl-c',
            component: 'totalAssets',
            value: normalizedValue.toString(),
            blockNumber: result.blockNumber,
            blockTime: new Date(day * 1000),
            seriesTime: new Date(day * 1000),
          })
        }
      }
    }

    console.log(`\n--- Database Upsert ---`)
    console.log('Rows to upsert:', rowsToUpsert.length)

    if (dryRun) {
      console.log('DRY RUN: Skipping database writes')
    } else {
      let dbSuccess = 0
      let dbFailed = 0
      const totalBatches = Math.ceil(rowsToUpsert.length / DB_BATCH_SIZE)

      for (let i = 0; i < rowsToUpsert.length; i += DB_BATCH_SIZE) {
        const batch = rowsToUpsert.slice(i, i + DB_BATCH_SIZE)
        const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1

        if (batchNum % 10 === 1 || batchNum === totalBatches) {
          console.log(`  [${batchNum}/${totalBatches}] Upserting ${batch.length} rows...`)
        }

        const result = await upsertTotalAssets(batch)
        dbSuccess += result.success
        dbFailed += result.failed
      }

      console.log('\n--- Database Stats ---')
      console.log('Rows upserted:', dbSuccess)
      console.log('Rows failed:', dbFailed)
      console.log('Success rate:', rowsToUpsert.length > 0 ? ((dbSuccess / rowsToUpsert.length) * 100).toFixed(2) + '%' : 'N/A')
    }
  }

  if (values.update === 'tvls') {
    // Collect unique assets and days per vault
    const assetsToFetch = new Set<string>()
    const vaultDays = new Map<string, number[]>() // vaultKey -> days[]

    for (const vault of vaults) {
      if (!vault.asset || !vault.inceptTime) {
        console.warn(`Skipping vault ${vault.chainId}:${vault.address} - no asset or inceptTime`)
        continue
      }

      const assetKey = `${vault.asset.chainId}:${vault.asset.address}`
      assetsToFetch.add(assetKey)

      const inceptTime = Number(vault.inceptTime)
      const vaultKey = `${vault.chainId}:${vault.address}`
      const days: number[] = []

      for (const day of window) {
        if (day >= inceptTime) {
          days.push(day)
        }
      }

      if (days.length > 0) {
        vaultDays.set(vaultKey, days)
      }
    }

    // Build coin IDs for DefiLlama
    const coinIds: string[] = []
    const assetLookup = new Map<string, { chainId: number; address: string }>()

    for (const assetKey of assetsToFetch) {
      const [chainIdStr, address] = assetKey.split(':')
      const chainId = Number(chainIdStr)
      const chainName = CHAIN_NAMES[chainId]
      if (chainName) {
        const coinId = `${chainName}:${address}`
        coinIds.push(coinId)
        assetLookup.set(coinId.toLowerCase(), { chainId, address })
      } else {
        console.warn(`  Unknown chain ${chainId} for asset ${address}, skipping price fetch`)
      }
    }

    // Collect unique days
    const uniqueDays = new Set<number>()
    for (const days of vaultDays.values()) {
      for (const day of days) {
        uniqueDays.add(day)
      }
    }

    console.log(`\n--- Price Fetching ---`)
    console.log('Unique assets:', assetsToFetch.size)
    console.log('Coin IDs to fetch:', coinIds.length)
    console.log('Unique days:', uniqueDays.size)

    // Fetch prices: day -> coinId -> price
    const historicalPrices = new Map<number, Map<string, number>>()
    const sortedDays = [...uniqueDays].sort((a, b) => a - b)
    let fetchedDays = 0
    let totalPricesFetched = 0

    for (const day of sortedDays) {
      fetchedDays++
      const dateStr = new Date(day * 1000).toISOString().split('T')[0]

      if (fetchedDays % 10 === 1 || fetchedDays === sortedDays.length) {
        console.log(`  [${fetchedDays}/${sortedDays.length}] ${dateStr}`)
      }

      const response = await fetchHistoricalPrices(coinIds, day)

      if (response) {
        const dayPrices = new Map<string, number>()

        for (const [coinId, priceData] of Object.entries(response.coins)) {
          const asset = assetLookup.get(coinId.toLowerCase())
          if (asset) {
            const assetKey = `${asset.chainId}:${asset.address}`
            dayPrices.set(assetKey, priceData.price)
            totalPricesFetched++
          }
        }

        historicalPrices.set(day, dayPrices)
      }

      await sleep(100)
    }

    console.log('\n--- Price Fetch Stats ---')
    console.log('Days fetched:', historicalPrices.size)
    console.log('Days without prices:', uniqueDays.size - historicalPrices.size)
    console.log('Total prices fetched:', totalPricesFetched)

    // Fetch block numbers for each unique (assetChainId, day) pair
    console.log(`\n--- Fetching block numbers for asset chains ---`)
    const assetBlockCache = new Map<string, bigint>() // "chainId:day" -> blockNumber

    const uniqueAssetChainDays = new Set<string>()
    for (const vault of vaults) {
      if (!vault.asset || !vault.inceptTime) continue
      const vaultKey = `${vault.chainId}:${vault.address}`
      const days = vaultDays.get(vaultKey)
      if (!days) continue

      for (const day of days) {
        uniqueAssetChainDays.add(`${vault.asset.chainId}:${day}`)
      }
    }

    let blockFetchCount = 0
    for (const key of uniqueAssetChainDays) {
      const [chainIdStr, dayStr] = key.split(':')
      const chainId = Number(chainIdStr)
      const day = Number(dayStr)

      if (!assetBlockCache.has(key)) {
        try {
          const blockNumber = await getBlockForTimestamp(chainId, day)
          assetBlockCache.set(key, blockNumber)
          blockFetchCount++
          if (blockFetchCount % 50 === 0) {
            console.log(`  Fetched ${blockFetchCount} block numbers...`)
          }
        } catch (error) {
          console.warn(`  Failed to get block for chain ${chainId} at ${day}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    console.log(`Block numbers fetched: ${assetBlockCache.size}`)

    // Now we need totalAssets from the database for each vault/day
    // Query the output table for totalAssets component
    console.log(`\n--- Fetching totalAssets from database ---`)

    const outputRowsToUpsert: OutputRow[] = []
    const priceRowMap = new Map<string, PriceRow>() // Dedupe prices: multiple vaults can share same asset
    let missingTotalAssets = 0
    let missingPrices = 0
    let missingAssetBlocks = 0

    for (const vault of vaults) {
      if (!vault.asset || !vault.inceptTime) continue

      const vaultKey = `${vault.chainId}:${vault.address}`
      const days = vaultDays.get(vaultKey)
      if (!days) continue

      const assetKey = `${vault.asset.chainId}:${vault.asset.address}`

      // Query totalAssets for this vault
      const totalAssetsQuery = `
        SELECT series_time, value, block_number
        FROM output
        WHERE chain_id = $1 AND address = $2 AND label = 'tvl-c' AND component = 'totalAssets'
        AND series_time >= $3 AND series_time <= $4
        ORDER BY series_time
      `
      const startDate = new Date(days[0] * 1000)
      const endDate = new Date(days[days.length - 1] * 1000)

      const result = await pool.query(totalAssetsQuery, [vault.chainId, vault.address, startDate, endDate])

      const totalAssetsMap = new Map<number, { value: number; blockNumber: bigint }>()
      for (const row of result.rows) {
        const timestamp = Math.floor(new Date(row.series_time).getTime() / 1000)
        totalAssetsMap.set(timestamp, {
          value: Number(row.value),
          blockNumber: BigInt(row.block_number),
        })
      }

      for (const day of days) {
        const totalAssetsData = totalAssetsMap.get(day)
        if (!totalAssetsData) {
          missingTotalAssets++
          continue
        }

        const dayPrices = historicalPrices.get(day)
        const priceUsd = dayPrices?.get(assetKey)
        if (priceUsd === undefined) {
          missingPrices++
          continue
        }

        // Get block number for asset chain at this day
        const assetBlockKey = `${vault.asset.chainId}:${day}`
        const assetBlockNumber = assetBlockCache.get(assetBlockKey)
        if (!assetBlockNumber) {
          missingAssetBlocks++
          continue
        }

        const tvl = totalAssetsData.value * priceUsd

        // Output record for tvl
        outputRowsToUpsert.push({
          chainId: vault.chainId,
          address: vault.address,
          label: 'tvl-c',
          component: 'tvl',
          value: tvl.toString(),
          blockNumber: totalAssetsData.blockNumber,
          blockTime: new Date(day * 1000),
          seriesTime: new Date(day * 1000),
        })

        // Output record for priceUsd
        outputRowsToUpsert.push({
          chainId: vault.chainId,
          address: vault.address,
          label: 'tvl-c',
          component: 'priceUsd',
          value: priceUsd.toString(),
          blockNumber: totalAssetsData.blockNumber,
          blockTime: new Date(day * 1000),
          seriesTime: new Date(day * 1000),
        })

        // Add price row - dedupe because multiple vaults can share the same asset
        const priceKey = `${vault.asset.chainId}:${vault.asset.address}:${assetBlockNumber}`
        if (!priceRowMap.has(priceKey)) {
          priceRowMap.set(priceKey, {
            chainId: vault.asset.chainId,
            address: vault.asset.address,
            priceUsd,
            priceSource: 'defillama',
            blockNumber: assetBlockNumber,
            blockTime: new Date(day * 1000),
          })
        }
      }
    }

    const priceRowsToUpsert = Array.from(priceRowMap.values())

    console.log('Missing totalAssets:', missingTotalAssets)
    console.log('Missing prices:', missingPrices)
    console.log('Missing asset blocks:', missingAssetBlocks)

    console.log(`\n--- Database Upsert ---`)
    console.log('Output rows to upsert:', outputRowsToUpsert.length)
    console.log('Price rows to upsert:', priceRowsToUpsert.length)

    if (dryRun) {
      console.log('DRY RUN: Skipping database writes')
    } else {
      let outputSuccess = 0
      let outputFailed = 0
      let priceSuccess = 0
      let priceFailed = 0

      // Batch both output and price rows together
      const maxRows = Math.max(outputRowsToUpsert.length, priceRowsToUpsert.length)
      const totalBatches = Math.ceil(maxRows / DB_BATCH_SIZE)

      for (let i = 0; i < maxRows; i += DB_BATCH_SIZE) {
        const outputBatch = outputRowsToUpsert.slice(i, i + DB_BATCH_SIZE)
        const priceBatch = priceRowsToUpsert.slice(i, i + DB_BATCH_SIZE)
        const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1

        if (batchNum % 10 === 1 || batchNum === totalBatches) {
          console.log(`  [${batchNum}/${totalBatches}] Upserting ${outputBatch.length} output rows, ${priceBatch.length} price rows...`)
        }

        const result = await upsertOutputAndPrices(outputBatch, priceBatch)
        outputSuccess += result.outputSuccess
        outputFailed += result.outputFailed
        priceSuccess += result.priceSuccess
        priceFailed += result.priceFailed
      }

      console.log('\n--- Database Stats ---')
      console.log('Output rows upserted:', outputSuccess)
      console.log('Output rows failed:', outputFailed)
      console.log('Price rows upserted:', priceSuccess)
      console.log('Price rows failed:', priceFailed)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n--- Completed in ${duration}s ---`)

  await pool.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
