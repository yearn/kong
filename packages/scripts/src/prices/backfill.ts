import { Pool, types as pgTypes } from 'pg'
import { parseArgs } from 'util'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============================================================================
// Chain ID to DefiLlama Name Mapping
// ============================================================================

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

function getDefillamaChainName(chainId: number): string | undefined {
  return CHAIN_NAMES[chainId]
}

// ============================================================================
// Types
// ============================================================================

interface Erc20Token {
  chainId: number
  address: string
  name: string | null
  symbol: string | null
  decimals: number | null
}

interface PriceRecord {
  chainId: number
  address: string
  priceUsd: number
  priceSource: string
  blockNumber: bigint
  blockTime: Date
}

interface SkipToken {
  chainId: number
  address: string
}

function loadSkipTokens(): Set<string> {
  try {
    const skipPath = join(__dirname, 'skip-tokens.json')
    const data = JSON.parse(readFileSync(skipPath, 'utf-8')) as SkipToken[]
    return new Set(data.map(t => `${t.chainId}:${t.address.toLowerCase()}`))
  } catch {
    return new Set()
  }
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function getDefaultStartDate(): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 30)
  return date.toISOString().split('T')[0]
}

function parseTokensArg(tokensArg: string): Erc20Token[] {
  // Format: "1:0xabc123,10:0xdef456" or "[1:0xabc123, 10:0xdef456]"
  const cleaned = tokensArg.replace(/[\[\]\s]/g, '')
  if (!cleaned) return []

  return cleaned.split(',').map(entry => {
    const [chainIdStr, address] = entry.split(':')
    const chainId = Number(chainIdStr)
    if (isNaN(chainId) || !address) {
      console.error(`Error: Invalid token format "${entry}". Expected "chainId:address"`)
      process.exit(1)
    }
    return {
      chainId,
      address,
      name: null,
      symbol: null,
      decimals: null,
    }
  })
}

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      start: { type: 'string', short: 's' },
      end: { type: 'string', short: 'e' },
      upsert: { type: 'string', short: 'u' },
      tokens: { type: 'string', short: 't' },
      'dry-run': { type: 'boolean', short: 'd' },
    },
  })

  const startDate = values.start ?? getDefaultStartDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    console.error('Error: --start must be in YYYY-MM-DD format')
    process.exit(1)
  }

  const endDate = values.end ?? new Date().toISOString().split('T')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    console.error('Error: --end must be in YYYY-MM-DD format')
    process.exit(1)
  }

  const upsertFlag = values.upsert === 'true'
  const tokensOverride = values.tokens ? parseTokensArg(values.tokens) : null
  const dryRun = values['dry-run'] ?? false

  return { startDate, endDate, upsertFlag, tokensOverride, dryRun }
}

// ============================================================================
// Database Connection
// ============================================================================

// Convert numeric (OID 1700) to float
pgTypes.setTypeParser(1700, 'text', parseFloat)

// Convert timestamptz (OID 1184) to seconds
pgTypes.setTypeParser(1184, (stringValue) => {
  return BigInt(Math.floor(Date.parse(stringValue) / 1000))
})

function getDb(): Pool {
  return new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DATABASE ?? 'kong',
    user: process.env.POSTGRES_USER ?? 'user',
    password: process.env.POSTGRES_PASSWORD ?? 'password',
    ssl: (process.env.POSTGRES_SSL === 'true')
      ? (process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'true')
        ? true
        : { rejectUnauthorized: false }
      : false,
  })
}

// ============================================================================
// Token Query
// ============================================================================

async function fetchErc20Tokens(db: Pool): Promise<Erc20Token[]> {
  const result = await db.query(`
    SELECT
      chain_id as "chainId",
      address,
      defaults->>'name' as name,
      defaults->>'symbol' as symbol,
      defaults->>'decimals' as decimals
    FROM thing
    WHERE label = 'erc20'
  `)
  return result.rows
}

// ============================================================================
// Batch Request Builder
// ============================================================================

const BATCH_SIZE = 100

function buildCoinIds(tokens: Erc20Token[]): string[] {
  // Filter to supported chains and build DefiLlama coin IDs
  const coinIds: string[] = []

  for (const token of tokens) {
    const chainName = getDefillamaChainName(token.chainId)
    if (chainName) {
      coinIds.push(`${chainName}:${token.address}`)
    }
  }

  return coinIds
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// ============================================================================
// DefiLlama API
// ============================================================================

const DEFILLAMA_API = process.env.DEFILLAMA_API ?? 'https://coins.llama.fi'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

async function fetchWithRetry<T>(
  url: string,
  description: string
): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url)

      if (response.status === 429) {
        // Rate limited - wait longer
        const retryAfter = Number(response.headers.get('Retry-After')) || 60
        console.warn(`    Rate limited. Waiting ${retryAfter}s...`)
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json() as T

    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (isLastAttempt) {
        console.error(`    ${description} failed after ${MAX_RETRIES} attempts: ${errorMsg}`)
        return null
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1)
      console.warn(`    ${description} failed (attempt ${attempt}/${MAX_RETRIES}): ${errorMsg}. Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  return null
}

interface DefillamaPriceResponse {
  coins: Record<string, {
    price: number
    symbol: string
    timestamp: number
    confidence?: number
  }>
}

interface DefillamaBlockResponse {
  height: number
  timestamp: number
}

// Block number cache: "chainId:timestamp" -> blockNumber
const blockCache = new Map<string, bigint>()

async function fetchBlockNumber(chainId: number, timestamp: number): Promise<bigint | null> {
  const cacheKey = `${chainId}:${timestamp}`
  if (blockCache.has(cacheKey)) {
    return blockCache.get(cacheKey)!
  }

  const chainName = getDefillamaChainName(chainId)
  if (!chainName) return null

  const url = `${DEFILLAMA_API}/block/${chainName}/${timestamp}`

  // Custom fetch for block numbers - 500 means chain not supported at this time
  try {
    const response = await fetch(url)
    if (response.status === 500) {
      console.warn(`    Block fetch for ${chainName}: 500 error, chain not supported at timestamp ${timestamp}`)
      blockCache.set(cacheKey, 0n)
      return 0n
    }
    if (!response.ok) {
      console.error(`    Block fetch for ${chainName} failed: HTTP ${response.status}`)
      return null
    }
    const data = await response.json() as DefillamaBlockResponse
    const blockNumber = BigInt(data.height)
    blockCache.set(cacheKey, blockNumber)
    return blockNumber
  } catch (error) {
    console.error(`    Block fetch for ${chainName} failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function fetchHistoricalPrices(
  coinIds: string[],
  timestamp: number
): Promise<DefillamaPriceResponse | null> {
  const coins = coinIds.join(',')
  const url = `${DEFILLAMA_API}/prices/historical/${timestamp}/${coins}`

  return fetchWithRetry<DefillamaPriceResponse>(url, 'Historical prices')
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertPrices(
  db: Pool,
  prices: PriceRecord[],
  upsert: boolean,
  dryRun: boolean
): Promise<{ inserted: number; skipped: number }> {
  if (prices.length === 0) return { inserted: 0, skipped: 0 }

  if (dryRun) {
    console.log(`  [DRY RUN] Would insert ${prices.length} prices`)
    return { inserted: prices.length, skipped: 0 }
  }

  // Build batch insert query
  const values: unknown[] = []
  const valuePlaceholders: string[] = []

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i]
    const offset = i * 6
    valuePlaceholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
    )
    values.push(
      p.chainId,
      p.address,
      p.priceUsd,
      p.priceSource,
      p.blockNumber.toString(),
      p.blockTime.toISOString()
    )
  }

  const onConflict = upsert
    ? `ON CONFLICT (chain_id, address, block_number) DO UPDATE SET
         price_usd = EXCLUDED.price_usd,
         price_source = EXCLUDED.price_source,
         block_time = EXCLUDED.block_time`
    : 'ON CONFLICT (chain_id, address, block_number) DO NOTHING'

  const query = `
    INSERT INTO price (chain_id, address, price_usd, price_source, block_number, block_time)
    VALUES ${valuePlaceholders.join(', ')}
    ${onConflict}
  `

  const result = await db.query(query, values)
  const inserted = result.rowCount ?? 0
  const skipped = prices.length - inserted

  return { inserted, skipped }
}

// ============================================================================
// Utilities
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const THROTTLE_MS = 500 // Delay between API requests

function getEndOfDayTimestamp(dateStr: string): number {
  // dateStr is YYYY-MM-DD, we want 23:59:59 UTC
  const date = new Date(`${dateStr}T23:59:59Z`)
  return Math.floor(date.getTime() / 1000)
}

function* dateRange(startDate: string, endDate: string): Generator<string> {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)

  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().split('T')[0]
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { startDate, endDate, upsertFlag, tokensOverride, dryRun } = parseCliArgs()

  console.log('='.repeat(60))
  console.log('DefiLlama Daily Price Backfill')
  console.log('='.repeat(60))
  console.log(`Start date:  ${startDate}`)
  console.log(`End date:    ${endDate}`)
  console.log(`Upsert mode: ${upsertFlag}`)
  console.log(`Dry run:     ${dryRun}`)
  console.log(`Tokens:      ${tokensOverride ? `${tokensOverride.length} from CLI` : 'from database'}`)
  console.log(`API:         ${process.env.DEFILLAMA_API ?? 'https://coins.llama.fi'}`)
  console.log('='.repeat(60))

  const db = getDb()
  console.log('Database connected')

  try {
    // Fetch tokens from CLI override or database
    const allTokens = tokensOverride ?? await fetchErc20Tokens(db)
    console.log(`Found ${allTokens.length} ERC20 tokens`)

    // Filter out skip tokens
    const skipTokens = loadSkipTokens()
    const tokens = allTokens.filter(t => !skipTokens.has(`${t.chainId}:${t.address.toLowerCase()}`))
    console.log(`Skipping ${skipTokens.size} tokens, ${tokens.length} remaining`)

    // Build coin IDs and chunk into batches
    const coinIds = buildCoinIds(tokens)
    console.log(`${coinIds.length} tokens on supported chains`)

    const batches = chunkArray(coinIds, BATCH_SIZE)
    console.log(`Split into ${batches.length} batch(es) of up to ${BATCH_SIZE} tokens`)

    // Build a lookup map: "chainName:address" -> token
    const tokenLookup = new Map<string, Erc20Token>()
    for (const token of tokens) {
      const chainName = getDefillamaChainName(token.chainId)
      if (chainName) {
        tokenLookup.set(`${chainName}:${token.address}`.toLowerCase(), token)
      }
    }

    const days = [...dateRange(startDate, endDate)]
    console.log(`Processing ${days.length} day(s)...`)

    // Track totals across all days
    let grandTotalInserted = 0
    let grandTotalSkipped = 0
    let grandTotalMissing = 0
    const allMissingTokens: { day: string; chainId: number; address: string; symbol: string | null }[] = []

    for (const day of days) {
      const timestamp = getEndOfDayTimestamp(day)
      const blockTime = new Date(timestamp * 1000)
      console.log(`\n[${day}] timestamp=${timestamp} (${blockTime.toISOString()})`)

      // Pre-fetch block numbers for all chains we need
      const chainsInBatch = new Set<number>()
      for (const token of tokens) {
        if (getDefillamaChainName(token.chainId)) {
          chainsInBatch.add(token.chainId)
        }
      }

      console.log(`  Fetching block numbers for ${chainsInBatch.size} chain(s)...`)
      const blockNumbers = new Map<number, bigint>()
      for (const chainId of chainsInBatch) {
        const blockNumber = await fetchBlockNumber(chainId, timestamp)
        if (blockNumber !== null) {
          blockNumbers.set(chainId, blockNumber)
        }
        await sleep(THROTTLE_MS)
      }
      console.log(`  Got block numbers for ${blockNumbers.size} chain(s)`)

      // Collect all prices for this day
      const dayPrices: PriceRecord[] = []
      let totalReceived = 0
      let totalMissing = 0

      // Fetch prices for each batch
      for (const [batchIndex, batch] of batches.entries()) {
        console.log(`  Batch ${batchIndex + 1}/${batches.length}: ${batch.length} tokens`)

        const priceResponse = await fetchHistoricalPrices(batch, timestamp)

        if (!priceResponse) {
          console.error(`    Batch failed, skipping ${batch.length} tokens`)
          totalMissing += batch.length
          // Track all tokens in failed batch as missing
          for (const coinId of batch) {
            const token = tokenLookup.get(coinId.toLowerCase())
            if (token) {
              allMissingTokens.push({ day, chainId: token.chainId, address: token.address, symbol: token.symbol })
            }
          }
        } else {
          const returnedCoins = new Set(Object.keys(priceResponse.coins).map(k => k.toLowerCase()))
          const returnedCount = returnedCoins.size
          totalReceived += returnedCount
          console.log(`    Received ${returnedCount} prices`)

          // Process each price
          for (const [coinId, priceData] of Object.entries(priceResponse.coins)) {
            const token = tokenLookup.get(coinId.toLowerCase())
            if (!token) {
              continue
            }

            const blockNumber = blockNumbers.get(token.chainId)
            if (!blockNumber) {
              continue
            }

            dayPrices.push({
              chainId: token.chainId,
              address: token.address,
              priceUsd: priceData.price,
              priceSource: 'defillama',
              blockNumber,
              blockTime,
            })
          }

          // Track tokens that didn't get prices
          for (const coinId of batch) {
            if (!returnedCoins.has(coinId.toLowerCase())) {
              const token = tokenLookup.get(coinId.toLowerCase())
              if (token) {
                allMissingTokens.push({ day, chainId: token.chainId, address: token.address, symbol: token.symbol })
              }
              totalMissing++
            }
          }
        }

        // Throttle between batches
        await sleep(THROTTLE_MS)
      }

      // Insert all prices for this day
      if (dayPrices.length > 0) {
        const { inserted, skipped } = await insertPrices(db, dayPrices, upsertFlag, dryRun)
        grandTotalInserted += inserted
        grandTotalSkipped += skipped
        grandTotalMissing += totalMissing
        console.log(`  Inserted ${inserted} prices, skipped ${skipped} (${totalMissing} missing from API)`)
      } else {
        grandTotalMissing += totalMissing
        console.log('  No prices to insert')
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('Summary')
    console.log('='.repeat(60))
    console.log(`Days processed: ${days.length}`)
    console.log(`Total inserted: ${grandTotalInserted}`)
    console.log(`Total skipped:  ${grandTotalSkipped}`)
    console.log(`Total missing:  ${grandTotalMissing}`)
    console.log('='.repeat(60))

    // Print and save missing tokens
    if (allMissingTokens.length > 0) {
      // console.log('\nMissing Prices:')
      // console.log('-'.repeat(60))
      // for (const { day, chainId, address, symbol } of allMissingTokens) {
      //   console.log(`  [${day}] ${chainId}:${address} (${symbol ?? 'unknown'})`)
      // }
      // console.log('-'.repeat(60))

      // Save missing tokens to JSON file
      // const filename = `missing-prices-${startDate}-to-${endDate}.json`
      // const uniqueTokens = [...new Map(
      //   allMissingTokens.map(t => [`${t.chainId}:${t.address}`, { chainId: t.chainId, address: t.address }])
      // ).values()]
      // writeFileSync(filename, JSON.stringify(uniqueTokens, null, 2))
      // console.log(`\nMissing tokens saved to ${filename} (${uniqueTokens.length} unique)`)
    }

    console.log('Done!')

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)

  } finally {
    await db.end()
    console.log('Database disconnected')
  }
}

main()
