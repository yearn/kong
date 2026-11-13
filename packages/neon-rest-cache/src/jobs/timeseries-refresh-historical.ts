import {
  getTrancheControllers,
  getTranches,
  getVaults,
} from '../../../web/app/api/rest/timeseries/db'
import { refreshHistoricalSeries } from '../../../web/app/api/rest/timeseries/historical'
import { trancheControllerLabels, trancheLabels, vaultLabels } from '../../../web/app/api/rest/timeseries/labels'
import { getTimeseriesKey } from '../../../web/app/api/rest/timeseries/redis'
import type { JobContext } from '../job-types'
import { throwSettledFailures } from './concurrency'

const BATCH_SIZE = 40

export async function refreshHistoricalTimeseries({
  sourceDb,
  cache,
  now: contextNow,
  historicalFullRefresh = false,
}: JobContext): Promise<void> {
  const now = Math.floor((contextNow ?? new Date()).getTime() / 1000)
  const [vaults, tranches, controllers] = await Promise.all([
    getVaults(sourceDb),
    getTranches(sourceDb),
    getTrancheControllers(sourceDb),
  ])
  const scopes = [
    { addresses: vaults, labels: vaultLabels },
    { addresses: tranches, labels: trancheLabels },
    { addresses: controllers, labels: trancheControllerLabels },
  ]
  const series = scopes.flatMap(({ addresses, labels }) => addresses.flatMap(address =>
    labels.map(({ label }) => ({ ...address, label })),
  ))

  for (let offset = 0; offset < series.length; offset += BATCH_SIZE) {
    const batch = series.slice(offset, offset + BATCH_SIZE)
    const keys = batch.map(({ label, chainId, address }) => getTimeseriesKey(label, chainId, address))
    const cached = await cache.getMany(keys)
    if (cached.length !== batch.length) {
      throw new Error(`Cache returned ${cached.length} values for ${batch.length} historical keys`)
    }

    const settled = await Promise.allSettled(batch.map(async ({ chainId, address, label }, index) => {
      const refreshed = await refreshHistoricalSeries(
        chainId,
        address,
        label,
        cached[index],
        now,
        historicalFullRefresh,
        sourceDb,
      )
      return [keys[index], refreshed.payload] as [string, string]
    }))
    // Let every query in the batch settle before deciding whether to publish.
    throwSettledFailures(settled)
    await cache.setMany(settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
  }
}
