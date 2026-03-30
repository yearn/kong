import { Pool } from 'pg'
import { getAddress } from 'viem'

const DAY_SECONDS = 86400
const CONCURRENCY = 10

interface TimeseriesRow {
  series_time: bigint
  tvl: string | null
  price_usd: string | null
  total_assets: string | null
}

interface Vault {
  chain_id: number
  address: string
  defaults: Record<string, unknown> | null
}

function hasGaps(data: TimeseriesRow[]): boolean {
  if (data.length === 0) return false

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const timestamp = Number(row.series_time)
    const tvl = row.tvl !== null ? parseFloat(row.tvl) : 0
    const totalAssets = row.total_assets !== null ? parseFloat(row.total_assets) : null

    // Missing days: timestamp gap > 1 day between consecutive points
    if (i > 0) {
      const prevTimestamp = Number(data[i - 1].series_time)
      if (timestamp - prevTimestamp > DAY_SECONDS) return true
    }

    if (tvl === 0) {
      // Legitimate zero: totalAssets is explicitly 0 (vault is empty)
      if (totalAssets === 0) continue
      // Non-legitimate zero: price gap, snapshot gap, or computation error
      return true
    }

    // Incomplete: tvl > 0 but totalAssets is null
    if (totalAssets === null) return true
  }

  return false
}

async function getVaults(pool: Pool): Promise<Vault[]> {
  const result = await pool.query<Vault>(
    'SELECT chain_id, address, defaults FROM thing WHERE label = $1 ORDER BY chain_id, address',
    ['vault']
  )
  return result.rows.filter((v) => v.defaults?.yearn === true && v.defaults?.apiVersion)
}

async function filterByMinTvl(pool: Pool, vaults: Vault[], minTvl: number): Promise<Vault[]> {
  if (vaults.length === 0) return []

  const addresses = vaults.map((v) => getAddress(v.address as `0x${string}`))
  const chainIds = Array.from(new Set(vaults.map((v) => v.chain_id)))

  const tvlResult = await pool.query<{ chain_id: number; address: string; value: string }>(
    `SELECT DISTINCT ON (chain_id, address) chain_id, address, value
    FROM output
    WHERE label = 'tvl-c' AND component = 'tvl'
      AND chain_id = ANY($1) AND address = ANY($2)
    ORDER BY chain_id, address, series_time DESC`,
    [chainIds, addresses]
  )

  const latestTvl = new Map<string, number>()
  for (const row of tvlResult.rows) {
    latestTvl.set(`${row.chain_id}:${row.address.toLowerCase()}`, Number(row.value))
  }
  return vaults.filter((v) => {
    const tvl = latestTvl.get(`${v.chain_id}:${v.address.toLowerCase()}`)
    return tvl !== undefined && tvl >= minTvl
  })
}

async function fetchTimeseries(pool: Pool, chainId: number, address: string, startDaysAgo: number): Promise<TimeseriesRow[]> {
  const result = await pool.query<TimeseriesRow>(
    `SELECT
      series_time,
      MAX(CASE WHEN component = 'tvl' THEN value END) as tvl,
      MAX(CASE WHEN component = 'priceUsd' THEN value END) as price_usd,
      MAX(CASE WHEN component = 'totalAssets' THEN value END) as total_assets
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = 'tvl-c'
      AND series_time >= NOW() - make_interval(days => $3)
    GROUP BY series_time
    ORDER BY series_time ASC`,
    [chainId, getAddress(address as `0x${string}`), startDaysAgo]
  )
  return result.rows
}

export async function detectTvlGaps(
  pool: Pool,
  options: { minTvl: number; startDaysAgo: number }
): Promise<{ chainId: number; address: string }[]> {
  const allVaults = await getVaults(pool)
  const vaults = await filterByMinTvl(pool, allVaults, options.minTvl)

  const gaps: { chainId: number; address: string }[] = []

  for (let i = 0; i < vaults.length; i += CONCURRENCY) {
    const batch = vaults.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (vault) => {
        const data = await fetchTimeseries(pool, vault.chain_id, vault.address, options.startDaysAgo)
        if (data.length === 0) return null
        if (hasGaps(data)) return { chainId: vault.chain_id, address: vault.address }
        return null
      })
    )
    for (const result of results) {
      if (result) gaps.push(result)
    }
  }

  return gaps
}
