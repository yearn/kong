import Keyv from 'keyv'
import { labels } from './labels'
import { getLatestTimeseries, getVaults, TimeseriesRow } from './db'
import { createTimeseriesKeyv, getTimeseriesKey } from './redis'

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
  const keyv = deps.keyv ?? createTimeseriesKeyv()
  const loadVaults = deps.getVaults ?? getVaults
  const loadLatestTimeseries = deps.getLatestTimeseries ?? getLatestTimeseries

  const vaults = await loadVaults()

  for (const vault of vaults) {
    const addressLower = vault.address.toLowerCase()

    for (const { label } of labels) {
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
    }
  }
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
