import { cacheMSet, disconnect } from '../cache'
import { getVaults, getVaultSnapshot } from './db'
import { getSnapshotKey } from './redis'
import { primeYieldSplitterCache } from '../../yieldSplitters'

const BATCH_SIZE = 10

async function refresh(): Promise<void> {
  console.time('refresh')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  await primeYieldSplitterCache()

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const pairs: Array<[string, string]> = []

    await Promise.all(batch.map(async (vault) => {
      const snapshot = await getVaultSnapshot(vault.chainId, vault.address)
      if (!snapshot) return
      pairs.push([
        getSnapshotKey(vault.chainId, vault.address.toLowerCase()),
        JSON.stringify({ value: snapshot }),
      ])
    }))

    await cacheMSet(pairs)

    processed += pairs.length
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refresh')
}

if (require.main === module) {
  refresh()
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
