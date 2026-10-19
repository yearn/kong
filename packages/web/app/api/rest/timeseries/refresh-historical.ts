import { cronDb } from '../../db/cron'
import { cacheMGet, cacheMSet } from '../cache'
import { getTrancheControllers, getTranches, getVaults } from './db'
import { refreshHistoricalSeries } from './historical'
import { trancheControllerLabels, trancheLabels, vaultLabels } from './labels'
import { getTimeseriesKey } from './redis'

const BATCH_SIZE = 40

export async function refreshHistorical(): Promise<void> {
  const started = Date.now()
  const now = Math.floor(started / 1000)
  const forceFull = process.env.TIMESERIES_HISTORICAL_FULL_REFRESH === 'true'
  const summary = { series: 0, full: 0, incremental: 0, rowsRead: 0, cacheBytes: 0 }

  try {
    const [vaults, tranches, controllers] = await Promise.all([
      getVaults(cronDb), getTranches(cronDb), getTrancheControllers(cronDb),
    ])
    const scopes = [
      { addresses: vaults, labels: vaultLabels },
      { addresses: tranches, labels: trancheLabels },
      { addresses: controllers, labels: trancheControllerLabels },
    ]
    const series = scopes.flatMap(({ addresses, labels }) => addresses.flatMap(vault =>
      labels.map(({ label }) => ({ ...vault, label })),
    ))

    for (let i = 0; i < series.length; i += BATCH_SIZE) {
      const batch = series.slice(i, i + BATCH_SIZE)
      const keys = batch.map(({ label, chainId, address }) => getTimeseriesKey(label, chainId, address))
      const cached = await cacheMGet(keys)
      const settled = await Promise.allSettled(batch.map(async ({ chainId, address, label }, index) => {
        const result = await refreshHistoricalSeries(chainId, address, label, cached[index], now, forceFull, cronDb)
        // Count completed DB work even if another read or the Redis write fails.
        summary.series++
        summary[result.full ? 'full' : 'incremental']++
        summary.rowsRead += result.rowsRead
        summary.cacheBytes += Buffer.byteLength(result.payload)
        return [keys[index], result.payload] as [string, string]
      }))
      // Settle every read before logging/returning a failed batch, so slower
      // successful reads are included and do not outlive the refresh job.
      const pairs: Array<[string, string]> = []
      for (const result of settled) {
        if (result.status === 'rejected') throw result.reason
        pairs.push(result.value)
      }
      await cacheMSet(pairs)
    }
  } finally {
    console.info('timeseries-refresh-historical', {
      ...summary, forceFull, durationMs: Date.now() - started,
      source: process.env.VERCEL_ENV || 'local',
      deployment: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    })
  }
}
