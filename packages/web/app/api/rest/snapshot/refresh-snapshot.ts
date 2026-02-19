import { createKeyvClient } from '../cache'
import { getVaults, getVaultSnapshot } from './db'
import { getSnapshotKey } from './redis'

const keyv = createKeyvClient()

const BATCH_SIZE = 10

async function refresh(): Promise<void> {
  console.time('refresh')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const snapshots = await Promise.all(batch.map(async (vault) => {
      const snapshot = await getVaultSnapshot(vault.chainId, vault.address)
      if (!snapshot) return null
      return {
        key: getSnapshotKey(vault.chainId, vault.address.toLowerCase()),
        value: snapshot,
      }
    }))

    const entries = snapshots.filter((s): s is NonNullable<typeof s> => s !== null)
    if (entries.length > 0) {
      await keyv.setMany(entries)
    }

    processed += entries.length
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
      await keyv.disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await keyv.disconnect()
      process.exit(1)
    })
}
