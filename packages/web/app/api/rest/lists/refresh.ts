import { getVaultsList } from './db'
import { createListsKeyv } from './redis'

async function refresh(): Promise<void> {
  console.time('refresh')

  const keyv = createListsKeyv('list:vaults')

  const vaults = await getVaultsList()

  const vaultsByChain = vaults.reduce((acc, vault) => {
    if (!acc[vault.chainId]) {
      acc[vault.chainId] = []
    }
    acc[vault.chainId].push(vault)
    return acc
  }, {} as Record<number, typeof vaults>)

  const chainIds = Object.keys(vaultsByChain).map(Number)
  for (const chainId of chainIds) {
    const chainVaults = vaultsByChain[chainId]
    await keyv.set(String(chainId), JSON.stringify(chainVaults))
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
