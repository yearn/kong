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
    label: { type: 'string', short: 'l' },
    concurrency: { type: 'string', short: 'n', default: '10' },
    json: { type: 'string', short: 'j' },
  },
})

const TIMESERIES_LABELS = [
  { label: 'tvl-c', segment: 'tvl', component: 'tvl' },
  { label: 'pps', segment: 'pps', component: 'humanized' },
  { label: 'apy-bwd-delta-pps', segment: 'apy-historical', component: 'net' },
]

const CHAIN_NAMES: Record<number, string> = {
  1: 'Mainnet',
  10: 'Optimism',
  137: 'Polygon',
  250: 'Fantom',
  8453: 'Base',
  42161: 'Arbitrum',
}

const API_BASE = process.env.API_BASE ?? 'https://kong.yearn.fi/api/rest/timeseries'
const DAY_SECONDS = 86400

interface Vault {
  chain_id: number
  address: string
}

interface TimeseriesPoint {
  time: number
  component: string
  value: string
}

interface Gap {
  from: number
  to: number
  days: number
  type: 'missing' | 'zero'
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

async function fetchTimeseries(
  chainId: number,
  address: string,
  segment: string,
  component: string
): Promise<TimeseriesPoint[]> {
  const url = `${API_BASE}/${segment}/${chainId}/${address}?components=${component}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error)
    return []
  }
}

function detectGaps(data: TimeseriesPoint[]): { gaps: Gap[]; zeroPoints: number; nonZeroPoints: number } {
  if (data.length < 2) return { gaps: [], zeroPoints: 0, nonZeroPoints: data.length }

  const sorted = [...data].sort((a, b) => a.time - b.time)
  const gaps: Gap[] = []

  // Count zeros and non-zeros
  const zeroPoints = sorted.filter((d) => parseFloat(d.value) === 0).length
  const nonZeroPoints = sorted.length - zeroPoints

  // Find the first non-zero value (start of real data)
  const firstNonZeroIndex = sorted.findIndex((d) => parseFloat(d.value) !== 0)
  if (firstNonZeroIndex === -1) {
    // All zeros - no gaps to report (vault never had TVL)
    return { gaps: [], zeroPoints, nonZeroPoints }
  }

  // Check for timestamp gaps (missing data points)
  for (let i = 1; i < sorted.length; i++) {
    const interval = sorted[i].time - sorted[i - 1].time
    if (interval > DAY_SECONDS) {
      gaps.push({
        from: sorted[i - 1].time,
        to: sorted[i].time,
        days: Math.floor(interval / DAY_SECONDS) - 1,
        type: 'missing',
      })
    }
  }

  // Check for zero-value gaps (zeros appearing after non-zero data)
  let inZeroPeriod = false
  let zeroStart: number | null = null

  for (let i = firstNonZeroIndex; i < sorted.length; i++) {
    const isZero = parseFloat(sorted[i].value) === 0

    if (isZero && !inZeroPeriod) {
      inZeroPeriod = true
      zeroStart = sorted[i].time
    } else if (!isZero && inZeroPeriod) {
      inZeroPeriod = false
      const days = Math.floor((sorted[i].time - zeroStart!) / DAY_SECONDS)
      if (days >= 1) {
        gaps.push({
          from: zeroStart!,
          to: sorted[i].time,
          days,
          type: 'zero',
        })
      }
      zeroStart = null
    }
  }

  // Handle trailing zeros (zero period at the end)
  if (inZeroPeriod && zeroStart !== null) {
    const lastTime = sorted[sorted.length - 1].time
    const days = Math.floor((lastTime - zeroStart) / DAY_SECONDS) + 1
    if (days >= 1) {
      gaps.push({
        from: zeroStart,
        to: lastTime,
        days,
        type: 'zero',
      })
    }
  }

  return { gaps, zeroPoints, nonZeroPoints }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0]
}

function formatReport(allGaps: VaultGaps[]): void {
  const gapsWithIssues = allGaps.filter((v) => v.gaps.length > 0)

  if (gapsWithIssues.length === 0) {
    console.log('\n=== Timeseries Gap Report ===\n')
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

  console.log('\n=== Timeseries Gap Report ===\n')

  for (const [chainId, vaults] of [...byChain.entries()].sort((a, b) => a[0] - b[0])) {
    const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`
    console.log(`Chain ${chainId} (${chainName}):`)

    const byAddress = new Map<string, VaultGaps[]>()
    for (const v of vaults) {
      const existing = byAddress.get(v.address) ?? []
      existing.push(v)
      byAddress.set(v.address, existing)
    }

    for (const [address, labelGaps] of byAddress) {
      console.log(`  ${address}:`)
      for (const lg of labelGaps) {
        const zeroGaps = lg.gaps.filter((g) => g.type === 'zero')
        const missingGaps = lg.gaps.filter((g) => g.type === 'missing')
        console.log(
          `    ${lg.label}: ${zeroGaps.length} zero-value gap(s), ${missingGaps.length} missing gap(s) (${lg.totalGapDays} total gap days, ${lg.zeroPoints}/${lg.dataPoints} zeros)`
        )
        for (const gap of lg.gaps.slice(0, 5)) {
          const typeLabel = gap.type === 'zero' ? 'ZERO' : 'MISSING'
          console.log(`      - [${typeLabel}] ${formatDate(gap.from)} to ${formatDate(gap.to)} (${gap.days} days)`)
        }
        if (lg.gaps.length > 5) {
          console.log(`      ... and ${lg.gaps.length - 5} more gaps`)
        }
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

    const labelsToCheck = values.label
      ? TIMESERIES_LABELS.filter((l) => l.label === values.label || l.segment === values.label)
      : TIMESERIES_LABELS

    if (labelsToCheck.length === 0) {
      console.error(`Unknown label: ${values.label}`)
      console.error(`Available: ${TIMESERIES_LABELS.map((l) => `${l.segment} (${l.label})`).join(', ')}`)
      process.exit(1)
    }

    const concurrency = Number(values.concurrency)
    const allGaps: VaultGaps[] = []

    // Build list of all tasks (vault + label combinations)
    const tasks: { vault: Vault; label: string; segment: string; component: string }[] = []
    for (const vault of vaults) {
      for (const { label, segment, component } of labelsToCheck) {
        tasks.push({ vault, label, segment, component })
      }
    }

    console.error(`Processing ${tasks.length} tasks with concurrency ${concurrency}...`)

    // Process in batches
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency)

      const results = await Promise.all(
        batch.map(async ({ vault, label, segment, component }) => {
          const data = await fetchTimeseries(vault.chain_id, vault.address, segment, component)
          if (data.length === 0) return null

          const { gaps, zeroPoints, nonZeroPoints } = detectGaps(data)
          const totalGapDays = gaps.reduce((sum, g) => sum + g.days, 0)

          return {
            chainId: vault.chain_id,
            address: vault.address,
            label,
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

      const processed = Math.min(i + concurrency, tasks.length)
      if (processed % 100 === 0 || processed === tasks.length) {
        console.error(`Processed ${processed}/${tasks.length} tasks...`)
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
