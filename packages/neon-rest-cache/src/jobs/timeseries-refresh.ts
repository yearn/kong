import {
  getRecentTimeseries,
  getTrancheControllers,
  getTranches,
  getVaults,
} from '../../../web/app/api/rest/timeseries/db'
import type { TimeseriesRow, VaultRow } from '../../../web/app/api/rest/timeseries/db'
import { trancheControllerLabels, trancheLabels, vaultLabels } from '../../../web/app/api/rest/timeseries/labels'
import { getTimeseriesLatestKey } from '../../../web/app/api/rest/timeseries/redis'
import type { JobContext } from '../job-types'
import { throwSettledFailures } from './concurrency'
import { stringifyCacheValue } from './json'

const CONCURRENCY = 10

async function getLatestPairs(vault: VaultRow, sourceDb: JobContext['sourceDb']): Promise<Array<[string, string]>> {
  const address = vault.address.toLowerCase()
  const pairs = await Promise.all(vaultLabels.map(async ({ label }) => {
    const rows: TimeseriesRow[] = await getRecentTimeseries(vault.chainId, vault.address, label, sourceDb)
    const value = rows.map(row => ({ time: Number(row.time), component: row.component, value: row.value }))
    return [getTimeseriesLatestKey(label, vault.chainId, address), stringifyCacheValue({ value })] as [string, string]
  }))
  return pairs
}

export async function refreshTimeseries({ sourceDb, cache }: JobContext): Promise<void> {
  const vaults = await getVaults(sourceDb)
  for (let offset = 0; offset < vaults.length; offset += CONCURRENCY) {
    const batch = vaults.slice(offset, offset + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map(vault => getLatestPairs(vault, sourceDb)))
    throwSettledFailures(settled)
    await cache.setMany(settled.flatMap(result => result.status === 'fulfilled' ? result.value : []))
  }

  // Query tranche/controller scopes in bounded batches, retaining the same
  // payload shaping used by the original scoped refresh helper.
  const scoped = [
    { addresses: await getTranches(sourceDb), labels: trancheLabels },
    { addresses: await getTrancheControllers(sourceDb), labels: trancheControllerLabels },
  ]
  for (const { addresses, labels } of scoped) {
    const tasks = addresses.flatMap(({ chainId, address }) => labels.map(({ label }) => ({ chainId, address, label })))
    for (let offset = 0; offset < tasks.length; offset += CONCURRENCY) {
      const batch = tasks.slice(offset, offset + CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(async ({ chainId, address, label }) => {
        const rows = await getRecentTimeseries(chainId, address, label, sourceDb)
        const value = rows.map(row => ({ time: Number(row.time), component: row.component, value: row.value }))
        return [getTimeseriesLatestKey(label, chainId, address.toLowerCase()), stringifyCacheValue({ value })] as [string, string]
      }))
      throwSettledFailures(settled)
      await cache.setMany(settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
    }
  }
}
