import { getVaultsList } from './db'
import { createListsKeyv, getListKey } from './redis'

async function refresh(): Promise<void> {
  console.time('refresh')

  const keyv = createListsKeyv()

  console.log('Fetching vaults list...')
  const vaults = await getVaultsList()
  console.log(`Found ${vaults.length} vaults`)

  console.log('Storing per-chain lists in Redis...')

  // Group vaults by chainId
  const vaultsByChain = vaults.reduce((acc, vault) => {
    if (!acc[vault.chainId]) {
      acc[vault.chainId] = []
    }
    acc[vault.chainId].push(vault)
    return acc
  }, {} as Record<number, typeof vaults>)

  // Store per-chain lists only
  const chainIds = Object.keys(vaultsByChain).map(Number)
  for (const chainId of chainIds) {
    const chainVaults = vaultsByChain[chainId]
    const chainKey = getListKey('vaults', chainId)
    await keyv.set(chainKey, JSON.stringify(chainVaults))
  }

  console.log(`✓ Completed: ${vaults.length} vaults cached across ${chainIds.length} chains`)
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
