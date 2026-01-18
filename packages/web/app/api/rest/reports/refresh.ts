import { getStrategyReports, VaultReport } from './db'
import { createReportsKeyv, getReportKey } from './redis'
import { getVaults } from '../timeseries/db'

const REFRESH_BATCH_SIZE = Number(process.env.REFRESH_BATCH_SIZE || 10)

async function refreshReports() {
  console.time('refreshReports')
  const keyv = createReportsKeyv()

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${REFRESH_BATCH_SIZE})`)

  let processed = 0

  async function processVault(vault: { chainId: number; address: string }) {
    const reports = await getStrategyReports(vault.chainId, vault.address)

    // Explicitly iterate through reports and handle BigInt serialization
    type SerializedVaultReport = {
      [K in keyof VaultReport]: VaultReport[K] extends bigint
        ? string
        : VaultReport[K] extends bigint | undefined
        ? string | undefined
        : VaultReport[K]
    }

    const serializedReports = reports.map(report => {
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
    })

    const cacheKey = getReportKey(vault.chainId, vault.address)
    await keyv.set(cacheKey, JSON.stringify(serializedReports))

    processed++
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  for (let i = 0; i < vaults.length; i += REFRESH_BATCH_SIZE) {
    const batch = vaults.slice(i, i + REFRESH_BATCH_SIZE)
    await Promise.all(batch.map(processVault))
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
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
