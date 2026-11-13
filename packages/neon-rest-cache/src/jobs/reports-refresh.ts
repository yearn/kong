import { getRecentStrategyReports, getVaults } from '../../../web/app/api/rest/reports/db'
import { getReportLatestKey } from '../../../web/app/api/rest/reports/redis'
import type { JobContext } from '../job-types'
import { throwSettledFailures } from './concurrency'
import { stringifyCacheValue } from './json'

const BATCH_SIZE = 10

export async function refreshReports({ sourceDb, cache }: JobContext): Promise<void> {
  const vaults = await getVaults(sourceDb)
  for (let offset = 0; offset < vaults.length; offset += BATCH_SIZE) {
    const batch = vaults.slice(offset, offset + BATCH_SIZE)
    const settled = await Promise.allSettled(batch.map(async ({ chainId, address }) => {
      const reports = await getRecentStrategyReports(chainId, address, sourceDb)
      if (!reports?.length) return null
      return [getReportLatestKey(chainId, address.toLowerCase()), stringifyCacheValue({ value: reports })] as [string, string]
    }))
    throwSettledFailures(settled)
    await cache.setMany(settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []))
  }
}
