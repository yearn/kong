import 'lib/global'
import { getVaults, getStrategyReports } from './db'
import { getReportKey } from './redis'
import { keyv } from '../cache'

const BATCH_SIZE = parseInt(process.env.REFRESH_BATCH_SIZE || '10', 10)

async function refreshReports(): Promise<void> {
  console.time('refreshReports')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(async (vault) => {
      const reports = await getStrategyReports(vault.chainId, vault.address)
      if (!reports || reports.length === 0) return null
      return {
        key: getReportKey(vault.chainId, vault.address.toLowerCase()),
        value: reports,
      }
    }))

    const entries = results.filter((r): r is NonNullable<typeof r> => r !== null)
    if (entries.length > 0) {
      await (keyv as any).setMany(entries)
    }

    processed += entries.length
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refreshReports')
}

if (require.main === module) {
  refreshReports()
    .then(async () => {
      await keyv.disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await keyv.disconnect()
      process.exit(1)
    })
}
