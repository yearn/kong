import 'lib/global'
import { cacheMSet, disconnect } from '../cache'
import { getStrategyReports, getVaults } from './db'
import { getReportKey } from './redis'

const BATCH_SIZE = parseInt(process.env.REFRESH_BATCH_SIZE || '10', 10)

async function refreshReports(): Promise<void> {
  console.time('refresh vault_reports')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const pairs: Array<[string, string]> = []

    await Promise.all(batch.map(async (vault) => {
      const reports = await getStrategyReports(vault.chainId, vault.address)
      if (!reports || reports.length === 0) return
      pairs.push([
        getReportKey(vault.chainId, vault.address.toLowerCase()),
        JSON.stringify({ value: reports }),
      ])
    }))

    await cacheMSet(pairs)

    processed += pairs.length
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refresh vault_reports')
}

if (require.main === module) {
  refreshReports()
    .then(async () => {
      await disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await disconnect()
      process.exit(1)
    })
}
