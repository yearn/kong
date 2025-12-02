import Keyv from 'keyv'
import { labels } from './labels'
import { getLatestTimeseries, getVaults, TimeseriesRow } from './db'
import { createTimeseriesKeyv, getTimeseriesKey } from './redis'

const BATCH_SIZE = 5

type Refresh15MinDeps = {
  keyv?: Keyv
  getVaults?: typeof getVaults
  getLatestTimeseries?: typeof getLatestTimeseries
}

type MinimalPoint = { time: number; component: string; value: number }

function upsertPoints(existing: MinimalPoint[], latest: TimeseriesRow[]): MinimalPoint[] {
  const updated = [...existing]

  for (const row of latest) {
    const time = Number(row.time)
    const idx = updated.findIndex(
      (point) => point.time === time && point.component === row.component,
    )

    const nextPoint = { time, component: row.component, value: row.value }
    if (idx >= 0) {
      updated[idx] = nextPoint
    } else {
      updated.push(nextPoint)
    }
  }

  return updated
}

export async function refresh15min(deps: Refresh15MinDeps = {}): Promise<void> {
  console.time('refresh15min')
  const keyv = deps.keyv ?? createTimeseriesKeyv()
  const loadVaults = deps.getVaults ?? getVaults
  const loadLatestTimeseries = deps.getLatestTimeseries ?? getLatestTimeseries

  console.log('Fetching vaults...')
  const vaults = await loadVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  async function processVault(vault: { chainId: number; address: string }) {
    const addressLower = vault.address.toLowerCase()

    await Promise.all(labels.map(async ({ label }) => {
      const cacheKey = getTimeseriesKey(label, vault.chainId, addressLower)
      const cached = await keyv.get(cacheKey)
      const parsed: MinimalPoint[] = cached ? JSON.parse(cached as string) : []

      const latestRows: TimeseriesRow[] = await loadLatestTimeseries(
        vault.chainId,
        vault.address,
        label,
      )

      const updated = upsertPoints(parsed, latestRows)
      await keyv.set(cacheKey, JSON.stringify(updated))
    }))

    processed++
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(processVault))
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refresh15min')
}

if (require.main === module) {
  refresh15min()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
