import Keyv from 'keyv'
import { labels } from './labels'
import { getFullTimeseries, getVaults, TimeseriesRow } from './db'
import { createTimeseriesKeyv, getTimeseriesKey } from './redis'

type Refresh24HrDeps = {
  keyv?: Keyv
  getVaults?: typeof getVaults
  getFullTimeseries?: typeof getFullTimeseries
}

export async function refresh24hr(deps: Refresh24HrDeps = {}): Promise<void> {
  const keyv = deps.keyv ?? createTimeseriesKeyv()
  const loadVaults = deps.getVaults ?? getVaults
  const loadFullTimeseries = deps.getFullTimeseries ?? getFullTimeseries

  const vaults = await loadVaults()

  for (const vault of vaults) {
    const addressLower = vault.address.toLowerCase()

    for (const { label } of labels) {
      const rows: TimeseriesRow[] = await loadFullTimeseries(
        vault.chainId,
        vault.address,
        label,
      )

      const minimal = rows.map(row => ({
        time: Number(row.time),
        component: row.component,
        value: row.value,
      }))

      const cacheKey = getTimeseriesKey(label, vault.chainId, addressLower)
      await keyv.set(cacheKey, JSON.stringify(minimal))
    }
  }
}

if (require.main === module) {
  refresh24hr()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
