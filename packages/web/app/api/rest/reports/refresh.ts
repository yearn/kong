import 'lib/global'
import { cacheMSet } from '../cache'
import { getRecentStrategyReports, getVaults } from './db'
import { getReportLatestKey } from './redis'

const BATCH_SIZE = parseInt(process.env.REFRESH_BATCH_SIZE || '10', 10)

export async function refreshLatest(): Promise<void> {
  const started = Date.now()

  try {
    console.log('Fetching vaults...')
    const vaults = await getVaults()
    console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

    let processed = 0

    for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
      const batch = vaults.slice(i, i + BATCH_SIZE)
      const pairs: Array<[string, string]> = []

      await Promise.all(batch.map(async (vault) => {
        const reports = await getRecentStrategyReports(vault.chainId, vault.address)
        if (!reports || reports.length === 0) return
        pairs.push([
          getReportLatestKey(vault.chainId, vault.address.toLowerCase()),
          JSON.stringify({ value: reports }),
        ])
      }))

      await cacheMSet(pairs)

      processed += batch.length
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${vaults.length} vaults`)
      }
    }

    console.log(`✓ Completed: ${processed} vaults processed`)
  } finally {
    console.log(`refresh vault_reports latest: ${Date.now() - started}ms`)
  }
}
