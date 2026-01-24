import 'lib/global'
import { getVaults, getStrategyReports } from './db'
import { createReportsKeyv, getReportKey } from './redis'

const BATCH_SIZE = parseInt(process.env.REFRESH_BATCH_SIZE || '10', 10)

async function refreshReports(): Promise<void> {
  console.time('refreshReports')
  const keyv = createReportsKeyv()

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  async function processVault(vault: { chainId: number; address: string }) {
    const addressLower = vault.address.toLowerCase()

    const reports = await getStrategyReports(vault.chainId, vault.address)

    if (!reports || reports.length === 0) {
      return
    }

    const cacheKey = getReportKey(vault.chainId, addressLower)
    await keyv.set(cacheKey, JSON.stringify(reports))

    processed++
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
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
