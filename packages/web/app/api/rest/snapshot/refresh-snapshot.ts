import { getVaults, getVaultSnapshot } from './db'
import { createSnapshotKeyv, getSnapshotKey } from './redis'

const BATCH_SIZE = 10

async function refresh(): Promise<void> {
  console.time('refresh')
  const keyv = createSnapshotKeyv()

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  async function processVault(vault: { chainId: number; address: string }) {
    const addressLower = vault.address.toLowerCase()

    const snapshot = await getVaultSnapshot(vault.chainId, vault.address)

    if (!snapshot) {
      return
    }

    const cacheKey = getSnapshotKey(vault.chainId, addressLower)
    await keyv.set(cacheKey, JSON.stringify(snapshot))

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
  console.timeEnd('refresh')
}

if (require.main === module) {
  refresh()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
