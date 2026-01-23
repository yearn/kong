import { getStrategyReports, VaultReport } from './db'
import { createReportsKeyv, getReportKey } from './redis'

type SerializedVaultReport = {
  [K in keyof VaultReport]: VaultReport[K] extends bigint
    ? string
    : VaultReport[K] extends bigint | undefined
    ? string | undefined
    : VaultReport[K]
}

function serializeReport(report: VaultReport): SerializedVaultReport {
  const serialized = { ...report } as unknown as SerializedVaultReport

  // Convert BigInts to strings for JSON serialization
  (Object.keys(serialized) as Array<keyof VaultReport>).forEach(key => {
    const value = report[key]
    if (typeof value === 'bigint') {
      // @ts-ignore - we know what we are doing here
      serialized[key] = value.toString()
    }
  })

  return serialized
}

async function refreshReports() {
  console.time('refreshReports')
  const keyv = createReportsKeyv()

  // Define the chains to process
  const chainIds = [1, 10, 137, 250, 8453, 42161]

  console.log(`Processing ${chainIds.length} chains...`)

  for (const chainId of chainIds) {
    console.log(`Fetching reports for chain ${chainId}...`)
    const reports = await getStrategyReports(chainId)

    if (reports.length === 0) {
      console.log(`  No reports found for chain ${chainId}`)
      continue
    }

    const serializedReports = reports.map(serializeReport)
    const cacheKey = getReportKey(chainId)

    await keyv.set(cacheKey, JSON.stringify(serializedReports))
    console.log(`  ✓ Cached ${serializedReports.length} reports for chain ${chainId}`)
  }

  console.log('✓ Refresh completed')
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
