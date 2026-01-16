import { Pool } from 'pg'
import { config } from 'dotenv'
import { parseArgs } from 'util'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '.env') })

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    chain: { type: 'string', short: 'c' },
    address: { type: 'string', short: 'a' },
    concurrency: { type: 'string', short: 'n', default: '10' },
    json: { type: 'string', short: 'j' },
  },
})

const CHAIN_NAMES: Record<number, string> = {
  1: 'Mainnet',
  10: 'Optimism',
  100: 'Gnosis',
  137: 'Polygon',
  146: 'Sonic',
  250: 'Fantom',
  8453: 'Base',
  42161: 'Arbitrum',
  80094: 'Berachain',
  747474: 'Katana',
}

const DAY_SECONDS = 86400

interface Vault {
  chain_id: number
  address: string
}

interface TimeseriesRow {
  series_time: Date
  tvl: string | null
  price_usd: string | null
  total_assets: string | null
}

interface Gap {
  from: number
  to: number
  days: number
  type: 'missing' | 'zero' | 'incomplete'
  classification: 'missing' | 'price' | 'snapshot' | 'computation'
}

interface VaultGaps {
  chainId: number
  address: string
  label: string
  gaps: Gap[]
  totalGapDays: number
  dataPoints: number
  zeroPoints: number
  nonZeroPoints: number
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  statement_timeout: 60000,
})

async function getVaults(): Promise<Vault[]> {
  let query = 'SELECT chain_id, address FROM thing WHERE label = $1'
  const params: (string | number)[] = ['vault']

  if (values.chain) {
    query += ' AND chain_id = $2'
    params.push(Number(values.chain))
  }

  if (values.address) {
    const addressParamIndex = params.length + 1
    query += ` AND LOWER(address) = $${addressParamIndex}`
    params.push(values.address.toLowerCase())
  }

  query += ' ORDER BY chain_id, address'

  const result = await pool.query<Vault>(query, params)
  return result.rows
}

async function fetchTimeseries(chainId: number, address: string): Promise<TimeseriesRow[]> {
  const result = await pool.query<TimeseriesRow>(
    `SELECT
      series_time,
      MAX(CASE WHEN component = 'tvl' THEN value END) as tvl,
      MAX(CASE WHEN component = 'priceUsd' THEN value END) as price_usd,
      MAX(CASE WHEN component = 'totalAssets' THEN value END) as total_assets
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = 'tvl-c'
    GROUP BY series_time
    ORDER BY series_time ASC`,
    [chainId, address]
  )
  return result.rows
}

function classifyZero(row: TimeseriesRow): 'price' | 'snapshot' | 'computation' | 'legitimate' {
  const priceUsd = row.price_usd !== null ? parseFloat(row.price_usd) : null
  const totalAssets = row.total_assets !== null ? parseFloat(row.total_assets) : null

  // Legitimate zero: totalAssets is 0 (not null)
  if (totalAssets === 0) {
    return 'legitimate'
  }

  // Price gap: tvl=0 and priceUsd=0
  if (priceUsd === 0 || priceUsd === null) {
    return 'price'
  }

  // Snapshot gap: tvl=0, priceUsd>0, totalAssets is null
  if (totalAssets === null) {
    return 'snapshot'
  }

  // Computation error: tvl=0, priceUsd>0, totalAssets>0
  return 'computation'
}

function isIncomplete(row: TimeseriesRow): boolean {
  const totalAssets = row.total_assets !== null ? parseFloat(row.total_assets) : null
  // Incomplete: tvl > 0 but totalAssets is null
  return totalAssets === null
}

function detectGaps(data: TimeseriesRow[]): { gaps: Gap[]; zeroPoints: number; nonZeroPoints: number } {
  if (data.length === 0) return { gaps: [], zeroPoints: 0, nonZeroPoints: 0 }

  const gaps: Gap[] = []
  let zeroPoints = 0
  let nonZeroPoints = 0

  // Track zero periods for consolidation
  let inZeroPeriod = false
  let zeroStart: number | null = null
  let zeroEnd: number | null = null
  let currentClassification: 'price' | 'snapshot' | 'computation' | null = null

  // Track incomplete periods (tvl > 0 but totalAssets is null)
  let inIncompletePeriod = false
  let incompleteStart: number | null = null
  let incompleteEnd: number | null = null

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const timestamp = Math.floor(row.series_time.getTime() / 1000)
    const tvl = row.tvl !== null ? parseFloat(row.tvl) : 0
    const isZero = tvl === 0

    // Check for missing days gap (timestamp gap > 1 day)
    if (i > 0) {
      const prevTimestamp = Math.floor(data[i - 1].series_time.getTime() / 1000)
      const interval = timestamp - prevTimestamp
      if (interval > DAY_SECONDS) {
        // Close any open zero period first
        if (inZeroPeriod && zeroStart !== null && zeroEnd !== null && currentClassification !== null) {
          const days = Math.floor((zeroEnd - zeroStart) / DAY_SECONDS) + 1
          gaps.push({
            from: zeroStart,
            to: zeroEnd,
            days,
            type: 'zero',
            classification: currentClassification,
          })
          inZeroPeriod = false
          zeroStart = null
          zeroEnd = null
          currentClassification = null
        }

        gaps.push({
          from: prevTimestamp,
          to: timestamp,
          days: Math.floor(interval / DAY_SECONDS) - 1,
          type: 'missing',
          classification: 'missing',
        })
      }
    }

    if (isZero) {
      // Close any open incomplete period when we hit a zero
      if (inIncompletePeriod && incompleteStart !== null && incompleteEnd !== null) {
        const days = Math.floor((incompleteEnd - incompleteStart) / DAY_SECONDS) + 1
        gaps.push({
          from: incompleteStart,
          to: incompleteEnd,
          days,
          type: 'incomplete',
          classification: 'snapshot',
        })
        inIncompletePeriod = false
        incompleteStart = null
        incompleteEnd = null
      }

      const classification = classifyZero(row)

      // Skip legitimate zeros
      if (classification === 'legitimate') {
        // Close any open zero period
        if (inZeroPeriod && zeroStart !== null && zeroEnd !== null && currentClassification !== null) {
          const days = Math.floor((zeroEnd - zeroStart) / DAY_SECONDS) + 1
          gaps.push({
            from: zeroStart,
            to: zeroEnd,
            days,
            type: 'zero',
            classification: currentClassification,
          })
          inZeroPeriod = false
          zeroStart = null
          zeroEnd = null
          currentClassification = null
        }
        nonZeroPoints++ // Count as non-zero since it's legitimate
        continue
      }

      zeroPoints++

      if (!inZeroPeriod) {
        // Start new zero period
        inZeroPeriod = true
        zeroStart = timestamp
        zeroEnd = timestamp
        currentClassification = classification
      } else if (classification === currentClassification) {
        // Extend current zero period
        zeroEnd = timestamp
      } else {
        // Classification changed - close current period and start new one
        if (zeroStart !== null && zeroEnd !== null && currentClassification !== null) {
          const days = Math.floor((zeroEnd - zeroStart) / DAY_SECONDS) + 1
          gaps.push({
            from: zeroStart,
            to: zeroEnd,
            days,
            type: 'zero',
            classification: currentClassification,
          })
        }
        zeroStart = timestamp
        zeroEnd = timestamp
        currentClassification = classification
      }
    } else {
      nonZeroPoints++

      // Close any open zero period
      if (inZeroPeriod && zeroStart !== null && zeroEnd !== null && currentClassification !== null) {
        const days = Math.floor((zeroEnd - zeroStart) / DAY_SECONDS) + 1
        gaps.push({
          from: zeroStart,
          to: zeroEnd,
          days,
          type: 'zero',
          classification: currentClassification,
        })
        inZeroPeriod = false
        zeroStart = null
        zeroEnd = null
        currentClassification = null
      }

      // Check for incomplete records (tvl > 0 but totalAssets is null)
      if (isIncomplete(row)) {
        if (!inIncompletePeriod) {
          inIncompletePeriod = true
          incompleteStart = timestamp
          incompleteEnd = timestamp
        } else {
          incompleteEnd = timestamp
        }
      } else {
        // Close any open incomplete period
        if (inIncompletePeriod && incompleteStart !== null && incompleteEnd !== null) {
          const days = Math.floor((incompleteEnd - incompleteStart) / DAY_SECONDS) + 1
          gaps.push({
            from: incompleteStart,
            to: incompleteEnd,
            days,
            type: 'incomplete',
            classification: 'snapshot',
          })
          inIncompletePeriod = false
          incompleteStart = null
          incompleteEnd = null
        }
      }
    }
  }

  // Handle trailing zeros
  if (inZeroPeriod && zeroStart !== null && zeroEnd !== null && currentClassification !== null) {
    const days = Math.floor((zeroEnd - zeroStart) / DAY_SECONDS) + 1
    gaps.push({
      from: zeroStart,
      to: zeroEnd,
      days,
      type: 'zero',
      classification: currentClassification,
    })
  }

  // Handle trailing incomplete periods
  if (inIncompletePeriod && incompleteStart !== null && incompleteEnd !== null) {
    const days = Math.floor((incompleteEnd - incompleteStart) / DAY_SECONDS) + 1
    gaps.push({
      from: incompleteStart,
      to: incompleteEnd,
      days,
      type: 'incomplete',
      classification: 'snapshot',
    })
  }

  return { gaps, zeroPoints, nonZeroPoints }
}

function formatDate(timestamp: number): string {
  // Database stores end-of-day timestamps (23:59:59), so no adjustment needed
  return new Date(timestamp * 1000).toISOString().split('T')[0]
}

function formatReport(allGaps: VaultGaps[]): void {
  const gapsWithIssues = allGaps.filter((v) => v.gaps.length > 0)

  if (gapsWithIssues.length === 0) {
    console.log('\n=== TVL-C Gap Report ===\n')
    console.log('No gaps detected in any vault timeseries.')
    console.log(`\nTotal vaults checked: ${allGaps.length}`)
    return
  }

  const byChain = new Map<number, VaultGaps[]>()
  for (const vg of gapsWithIssues) {
    const existing = byChain.get(vg.chainId) ?? []
    existing.push(vg)
    byChain.set(vg.chainId, existing)
  }

  console.log('\n=== TVL-C Gap Report ===\n')

  for (const [chainId, vaults] of [...byChain.entries()].sort((a, b) => a[0] - b[0])) {
    const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`
    console.log(`Chain ${chainId} (${chainName}):`)

    for (const v of vaults) {
      const zeroGaps = v.gaps.filter((g) => g.type === 'zero')
      const missingGaps = v.gaps.filter((g) => g.type === 'missing')
      const incompleteGaps = v.gaps.filter((g) => g.type === 'incomplete')
      console.log(`  ${v.address}:`)
      console.log(
        `    ${zeroGaps.length} zero gap(s), ${incompleteGaps.length} incomplete gap(s), ${missingGaps.length} missing gap(s) (${v.totalGapDays} total gap days)`
      )
      for (const gap of v.gaps.slice(0, 5)) {
        const typeLabel = gap.type === 'zero' ? `ZERO:${gap.classification}` : gap.type === 'incomplete' ? 'INCOMPLETE' : 'MISSING'
        console.log(`      - [${typeLabel}] ${formatDate(gap.from)} to ${formatDate(gap.to)} (${gap.days} days)`)
      }
      if (v.gaps.length > 5) {
        console.log(`      ... and ${v.gaps.length - 5} more gaps`)
      }
    }
    console.log()
  }

  const totalGaps = gapsWithIssues.reduce((sum, v) => sum + v.gaps.length, 0)
  const totalGapDays = gapsWithIssues.reduce((sum, v) => sum + v.totalGapDays, 0)

  console.log('Summary:')
  console.log(`  Total vaults checked: ${allGaps.length}`)
  console.log(`  Vaults with gaps: ${gapsWithIssues.length}`)
  console.log(`  Total gaps found: ${totalGaps}`)
  console.log(`  Total gap days: ${totalGapDays}`)
}

function formatJson(allGaps: VaultGaps[], filename: string): void {
  const output = {
    generated: new Date().toISOString(),
    summary: {
      totalVaults: allGaps.length,
      vaultsWithGaps: allGaps.filter((v) => v.gaps.length > 0).length,
      totalGaps: allGaps.reduce((sum, v) => sum + v.gaps.length, 0),
      totalGapDays: allGaps.reduce((sum, v) => sum + v.totalGapDays, 0),
    },
    gaps: allGaps
      .filter((v) => v.gaps.length > 0)
      .map((v) => ({
        chainId: v.chainId,
        address: v.address,
        label: v.label,
        dataPoints: v.dataPoints,
        zeroPoints: v.zeroPoints,
        nonZeroPoints: v.nonZeroPoints,
        totalGapDays: v.totalGapDays,
        gaps: v.gaps.map((g) => ({
          type: g.type,
          classification: g.classification,
          from: formatDate(g.from),
          to: formatDate(g.to),
          days: g.days,
        })),
      })),
  }
  writeFileSync(filename, JSON.stringify(output, null, 2))
  console.error(`JSON report written to ${filename}`)
}

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

async function main() {
  if (values.address && !isValidAddress(values.address)) {
    console.error(`Invalid address format: ${values.address}`)
    console.error('Address must be a 40-character hex string starting with 0x')
    process.exit(1)
  }

  try {
    console.error('Connecting to database...')
    await pool.query('SELECT 1')
    console.error('Connected.')

    console.error('Fetching vaults...')
    const vaults = await getVaults()
    console.error(`Found ${vaults.length} vault(s).`)

    const concurrency = Number(values.concurrency)
    const allGaps: VaultGaps[] = []

    console.error(`Processing ${vaults.length} vaults with concurrency ${concurrency}...`)

    // Process in batches
    for (let i = 0; i < vaults.length; i += concurrency) {
      const batch = vaults.slice(i, i + concurrency)

      const results = await Promise.all(
        batch.map(async (vault) => {
          const data = await fetchTimeseries(vault.chain_id, vault.address)
          if (data.length === 0) return null

          const { gaps, zeroPoints, nonZeroPoints } = detectGaps(data)
          const totalGapDays = gaps.reduce((sum, g) => sum + g.days, 0)

          return {
            chainId: vault.chain_id,
            address: vault.address,
            label: 'tvl-c',
            gaps,
            totalGapDays,
            dataPoints: data.length,
            zeroPoints,
            nonZeroPoints,
          } as VaultGaps
        })
      )

      for (const result of results) {
        if (result) allGaps.push(result)
      }

      const processed = Math.min(i + concurrency, vaults.length)
      if (processed % 100 === 0 || processed === vaults.length) {
        console.error(`Processed ${processed}/${vaults.length} vaults...`)
      }
    }

    if (values.json) {
      formatJson(allGaps, values.json)
    }
    formatReport(allGaps)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
