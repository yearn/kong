import { cacheMSet, disconnect } from '../cache'
import { getRecentTimeseriesByLabel, getVaults } from './db'
import { labels } from './labels'
import { getTimeseriesLatestKey } from './redis'

// Empty envelope for vaults with no data in the recent window; written so stale
// latest entries get cleared, matching the previous per-vault overwrite.
const EMPTY_SERIES = '{"value": []}'

async function refreshLatest(): Promise<void> {
  console.time('refreshLatest')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults across ${labels.length} labels`)

  // One chunk-pruned scan per label (4 total) instead of vaults × labels queries.
  for (const { label } of labels) {
    const rows = await getRecentTimeseriesByLabel(label)
    const byVault = new Map(
      rows.map((row) => [`${row.chainId}:${row.address.toLowerCase()}`, row.payload]),
    )

    const pairs: Array<[string, string]> = vaults.map((vault) => {
      const addressLower = vault.address.toLowerCase()
      return [
        getTimeseriesLatestKey(label, vault.chainId, addressLower),
        byVault.get(`${vault.chainId}:${addressLower}`) ?? EMPTY_SERIES,
      ]
    })

    await cacheMSet(pairs)
    console.log(`✓ ${label}: ${rows.length}/${vaults.length} vaults with recent data`)
  }

  console.log(`✓ Completed: ${vaults.length} vaults processed`)
  console.timeEnd('refreshLatest')
}

if (require.main === module) {
  refreshLatest()
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
