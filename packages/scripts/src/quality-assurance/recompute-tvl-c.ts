import { z } from 'zod'
import { parseArgs } from 'util'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getAddress } from 'viem'

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
    vaults: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
  },
})

const startTimestamp = values.start ? Math.floor(new Date(values.start).getTime() / 1000) : null
const nowTimestamp = Math.floor(Date.now() / 1000)
const todayStart = nowTimestamp - (nowTimestamp % 86400)
const endTimestamp = values.end
  ? Math.min(Math.floor(new Date(values.end).getTime() / 1000), todayStart)
  : todayStart

const VaultSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  name: z.string(),
  asset: z.object({
    chainId: z.number(),
    address: z.string(),
    name: z.string(),
  }).nullable(),
  tvl: z.object({
    close: z.number().nullable(),
  }).nullable(),
  inceptTime: z.string().nullable(),
  inceptBlock: z.string().nullable(),
  origin: z.string().nullable(),
})

const VaultsResponseSchema = z.object({
  data: z.object({
    vaults: z.array(VaultSchema),
  }),
})

const query = `
query Vaults {
  vaults {
    chainId
    address
    name
    asset {
      chainId
      address
      name
    }
    tvl {
      close
    }
    inceptTime
    inceptBlock
    origin
  }
}
`

const response = await fetch('https://kong.yearn.fi/api/gql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
const data = await response.json()
const vaults = VaultsResponseSchema.parse(data).data.vaults

let targetVaults: typeof vaults

if (values.vaults) {
  const requested = values.vaults.split(',').map(pair => {
    const [chainId, address] = pair.split(':')
    return { chainId: Number(chainId), address: getAddress(address) }
  })

  targetVaults = []
  for (const req of requested) {
    const found = vaults.find(v => v.chainId === req.chainId && v.address === req.address)
    if (!found) {
      throw new Error(`Vault not found: ${req.chainId}:${req.address}`)
    }
    targetVaults.push(found)
  }
} else {
  targetVaults = vaults.filter(v => v.origin === 'yearn' && (v.tvl?.close ?? 0) >= 500)
}

console.log('Target vaults count:', targetVaults.length)

const DAY_SECONDS = 86400

function getDaysSinceIncept(inceptTime: number, minStart: number | null, maxEnd: number): number[] {
  const days: number[] = []

  // Use the later of inceptTime or minStart
  const effectiveStart = minStart ? Math.max(inceptTime, minStart) : inceptTime

  // Start from the end of the effective start day (last second = 23:59:59)
  let day = effectiveStart - (effectiveStart % DAY_SECONDS) + DAY_SECONDS - 1

  // Stop before maxEnd
  while (day < maxEnd) {
    days.push(day)
    day += DAY_SECONDS
  }
  return days
}

// pricesToFetch: Set of unique chainId:address
const pricesToFetch = new Set<string>()
const uniqueDays = new Set<number>()
let totalAssetDays = 0

for (const vault of targetVaults) {
  if (!vault.asset || !vault.inceptTime) continue
  pricesToFetch.add(`${vault.asset.chainId}:${vault.asset.address}`)

  const days = getDaysSinceIncept(Number(vault.inceptTime), startTimestamp, endTimestamp)
  for (const day of days) {
    uniqueDays.add(day)
  }
  totalAssetDays += days.length
}

console.log('\n--- Prices to Fetch ---')
console.log('Vaults processed:', targetVaults.length)
console.log('Unique assets:', pricesToFetch.size)
console.log('Unique days:', uniqueDays.size)
console.log('Total asset-days:', totalAssetDays)

// Chain ID to DefiLlama name mapping
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

interface HistoricalPrice {
  chainId: number
  address: string
  price: number
  source: 'defillama'
}

interface DefillamaPriceResponse {
  coins: Record<string, {
    price: number
    symbol: string
    timestamp: number
    confidence?: number
  }>
}

const DEFILLAMA_API = process.env.DEFILLAMA_API ?? 'https://coins.llama.fi'

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

// historicalPrices: dayTimestamp -> [{ chainId, address, price, source }]
const historicalPrices = new Map<number, HistoricalPrice[]>()

// Build coin IDs for all assets
const coinIds: string[] = []
const assetLookup = new Map<string, { chainId: number; address: string }>()

for (const assetKey of pricesToFetch) {
  const [chainIdStr, address] = assetKey.split(':')
  const chainId = Number(chainIdStr)
  const chainName = CHAIN_NAMES[chainId]
  if (chainName) {
    const coinId = `${chainName}:${address}`
    coinIds.push(coinId)
    assetLookup.set(coinId.toLowerCase(), { chainId, address })
  }
}

console.log(`\nFetching prices for ${coinIds.length} assets across ${uniqueDays.size} days...`)

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
    const dayPrices: HistoricalPrice[] = []

    for (const [coinId, priceData] of Object.entries(response.coins)) {
      const asset = assetLookup.get(coinId.toLowerCase())
      if (asset) {
        dayPrices.push({
          chainId: asset.chainId,
          address: asset.address,
          price: priceData.price,
          source: 'defillama',
        })
      }
    }

    historicalPrices.set(day, dayPrices)
    totalPricesFetched += dayPrices.length
  }

  await sleep(250)
}

// Stats about historicalPrices
const daysWithPrices = historicalPrices.size
const daysWithoutPrices = uniqueDays.size - daysWithPrices
const avgPricesPerDay = daysWithPrices > 0 ? (totalPricesFetched / daysWithPrices).toFixed(1) : 0

console.log('\n--- Historical Prices Stats ---')
console.log('Days fetched:', daysWithPrices)
console.log('Days without prices:', daysWithoutPrices)
console.log('Total prices fetched:', totalPricesFetched)
console.log('Avg prices per day:', avgPricesPerDay)

await pool.end()
