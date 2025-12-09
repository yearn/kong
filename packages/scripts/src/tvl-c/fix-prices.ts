import { Pool, types as pgTypes } from 'pg'
import { parseArgs } from 'util'

// ============================================================================
// Database Connection
// ============================================================================

// Convert numeric (OID 1700) to float
pgTypes.setTypeParser(1700, 'text', parseFloat)

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
// Types
// ============================================================================

interface Vault {
  chainId: number
  address: string
  decimals: number
}

interface BrokenRecord {
  chainId: number
  address: string
  seriesTime: Date
  blockNumber: string
  blockTime: Date
  totalAssets: number
  delegatedAssets: number
}

interface LegacyTvl {
  seriesTime: Date
  value: number
}

// ============================================================================
// Utilities
// ============================================================================

// Truncate date to seconds (ignore milliseconds)
function toSecondKey(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseVaultsArg(vaultsArg: string): { chainId: number; address: string }[] {
  const cleaned = vaultsArg.replace(/[\[\]\s]/g, '')
  if (!cleaned) return []

  return cleaned.split(',').map(entry => {
    const [chainIdStr, address] = entry.split(':')
    const chainId = Number(chainIdStr)
    if (isNaN(chainId) || !address) {
      console.error(`Error: Invalid vault format "${entry}". Expected "chainId:address"`)
      process.exit(1)
    }
    return { chainId, address }
  })
}

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      vaults: { type: 'string', short: 'v' },
      since: { type: 'string', short: 's', default: '2024-01-01' },
    },
  })

  const sinceDate = new Date(values.since ?? '2024-01-01')
  if (isNaN(sinceDate.getTime())) {
    console.error('Error: --since must be a valid date (e.g., 2024-01-01)')
    process.exit(1)
  }

  const vaultsOverride = values.vaults ? parseVaultsArg(values.vaults) : null

  return { sinceDate, vaultsOverride }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { sinceDate, vaultsOverride } = parseCliArgs()

  console.log('='.repeat(60))
  console.log('Backport Legacy TVLs to TVL-C')
  console.log('='.repeat(60))
  console.log(`Since: ${sinceDate.toISOString().split('T')[0]}`)
  console.log(`Vaults: ${vaultsOverride ? `${vaultsOverride.length} from CLI` : 'from database'}`)
  console.log('='.repeat(60))

  const db = getDb()
  console.log('Database connected')

  try {
    let vaults: Vault[]

    if (vaultsOverride) {
      // Fetch decimals for specified vaults
      const vaultList: Vault[] = []
      for (const v of vaultsOverride) {
        const result = await db.query<{ decimals: number }>(
          `SELECT (defaults->>'decimals')::int as decimals
           FROM thing
           WHERE chain_id = $1 AND address = $2 AND label = 'vault'`,
          [v.chainId, v.address]
        )
        if (result.rows.length > 0) {
          vaultList.push({ chainId: v.chainId, address: v.address, decimals: result.rows[0].decimals })
        } else {
          console.warn(`⚠️ Vault not found: ${v.chainId}:${v.address}`)
        }
      }
      vaults = vaultList
    } else {
      const result = await db.query<Vault>(
        `SELECT
           chain_id as "chainId",
           address,
           (defaults->>'decimals')::int as decimals
         FROM thing
         WHERE label = 'vault'`
      )
      vaults = result.rows
    }

    console.log(`Processing ${vaults.length} vaults`)

    let totalUpdated = 0
    let totalSkipped = 0
    let totalNoLegacy = 0
    const startTime = Date.now()

    for (let vaultIndex = 0; vaultIndex < vaults.length; vaultIndex++) {
      const vault = vaults[vaultIndex]
      const { chainId, address } = vault

      // Calculate ETA
      let eta = ''
      if (vaultIndex > 0) {
        const elapsed = Date.now() - startTime
        const avgPerVault = elapsed / vaultIndex
        const remaining = avgPerVault * (vaults.length - vaultIndex)
        const hours = Math.floor(remaining / 3600000)
        const minutes = Math.floor((remaining % 3600000) / 60000)
        const seconds = Math.floor((remaining % 60000) / 1000)
        eta = ` | ETA: ${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      }

      console.log(`\n📦 [${vaultIndex + 1}/${vaults.length}${eta}] Processing vault ${chainId}:${address}`)

      // Find broken tvl-c records: priceUsd=0, but totalAssets > 0
      const brokenResult = await db.query<BrokenRecord>(
        `SELECT
           o.chain_id as "chainId",
           o.address,
           o.series_time as "seriesTime",
           o.block_number as "blockNumber",
           o.block_time as "blockTime",
           ta.value as "totalAssets",
           COALESCE(da.value, 0) as "delegatedAssets"
         FROM output o
         JOIN output ta ON (
           ta.chain_id = o.chain_id
           AND ta.address = o.address
           AND ta.label = 'tvl-c'
           AND ta.component = 'totalAssets'
           AND ta.series_time = o.series_time
         )
         LEFT JOIN output da ON (
           da.chain_id = o.chain_id
           AND da.address = o.address
           AND da.label = 'tvl-c'
           AND da.component = 'delegatedAssets'
           AND da.series_time = o.series_time
         )
         WHERE o.chain_id = $1
           AND o.address = $2
           AND o.label = 'tvl-c'
           AND o.component = 'priceUsd'
           AND o.value = 0
           AND ta.value > 0
           AND o.series_time >= $3
         ORDER BY o.series_time`,
        [chainId, address, sinceDate]
      )

      const brokenRecords = brokenResult.rows

      if (brokenRecords.length === 0) {
        console.log('  ✅ No broken records found')
        continue
      }

      console.log(`  🔍 Found ${brokenRecords.length} broken records`)

      // Fetch all legacy TVL records for this vault in the date range
      const legacyResult = await db.query<LegacyTvl>(
        `SELECT series_time as "seriesTime", value
         FROM output
         WHERE chain_id = $1
           AND address = $2
           AND label = 'tvl'
           AND component <> 'na'
           AND series_time >= $3
         ORDER BY series_time`,
        [chainId, address, sinceDate]
      )

      // Build a map for fast lookup by series_time (truncated to seconds)
      const legacyMap = new Map<string, number>()
      for (const legacy of legacyResult.rows) {
        legacyMap.set(toSecondKey(legacy.seriesTime), legacy.value)
      }

      let vaultUpdated = 0
      let vaultSkipped = 0
      let vaultNoLegacy = 0

      // Collect updates to batch
      const updates: { seriesTime: Date; priceUsd: number; tvl: number; delegated: number }[] = []

      for (const record of brokenRecords) {
        const { seriesTime, totalAssets, delegatedAssets } = record

        // Look up legacy TVL (truncated to seconds)
        const legacyTvl = legacyMap.get(toSecondKey(seriesTime))

        if (legacyTvl === undefined) {
          console.warn(`  ⚠️ No legacy TVL for ${seriesTime.toISOString()}`)
          vaultNoLegacy++
          continue
        }

        if (legacyTvl === 0) {
          vaultSkipped++
          continue
        }

        if (totalAssets === 0) {
          vaultSkipped++
          continue
        }

        // Reverse-engineer price: priceUsd = legacy_tvl / totalAssets
        const priceUsd = legacyTvl / totalAssets

        // Recompute values
        const tvl = totalAssets * priceUsd
        const delegated = delegatedAssets * priceUsd

        updates.push({ seriesTime, priceUsd, tvl, delegated })
      }

      // Process updates in batches of 100
      const BATCH_SIZE = 50
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(updates.length / BATCH_SIZE)
        console.log(`  📝 Batch ${batchNum}/${totalBatches} (${batch.length} records)`)

        for (const { seriesTime, priceUsd, tvl, delegated } of batch) {
          await db.query(
            `UPDATE output
             SET value = $1
             WHERE chain_id = $2
               AND address = $3
               AND label = 'tvl-c'
               AND component = 'priceUsd'
               AND series_time = $4`,
            [priceUsd, chainId, address, seriesTime]
          )

          await db.query(
            `UPDATE output
             SET value = $1
             WHERE chain_id = $2
               AND address = $3
               AND label = 'tvl-c'
               AND component = 'tvl'
               AND series_time = $4`,
            [tvl, chainId, address, seriesTime]
          )

          await db.query(
            `UPDATE output
             SET value = $1
             WHERE chain_id = $2
               AND address = $3
               AND label = 'tvl-c'
               AND component = 'delegated'
               AND series_time = $4`,
            [delegated, chainId, address, seriesTime]
          )

          vaultUpdated++
        }
      }

      console.log(`  ✅ Updated: ${vaultUpdated}, Skipped: ${vaultSkipped}, No legacy: ${vaultNoLegacy}`)
      totalUpdated += vaultUpdated
      totalSkipped += vaultSkipped
      totalNoLegacy += vaultNoLegacy
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('Summary')
    console.log('='.repeat(60))
    console.log(`Total updated:   ${totalUpdated}`)
    console.log(`Total skipped:   ${totalSkipped}`)
    console.log(`Total no legacy: ${totalNoLegacy}`)
    console.log('='.repeat(60))
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
