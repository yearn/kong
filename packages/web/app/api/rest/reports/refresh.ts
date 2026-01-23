import 'lib/global'
import { getStrategyReports } from './db'
import { createReportsKeyv, getReportKey } from './redis'

async function refreshReports() {
  console.time('refreshReports')

  const keyv = createReportsKeyv()

  const reports = await getStrategyReports()

  const reportsByChain = reports.reduce((acc, report) => {
    if (!acc[report.chainId]) {
      acc[report.chainId] = []
    }
    acc[report.chainId].push(report)
    return acc
  }, {} as Record<number, typeof reports>)

  const chainIds = Object.keys(reportsByChain).map(Number)
  for (const chainId of chainIds) {
    const chainReports = reportsByChain[chainId]
    const cacheKey = getReportKey(chainId)
    await keyv.set(cacheKey, JSON.stringify(chainReports))
  }

  console.log(`✓ Completed: ${reports.length} reports cached across ${chainIds.length} chains`)
  console.timeEnd('refreshReports')
}

if (require.main === module) {
  refreshReports()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
