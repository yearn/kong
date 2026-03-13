import { createKeyvClient } from '../cache'
import { getVaultsList } from './db'

const keyv = createKeyvClient()

async function refresh(): Promise<void> {
  console.time('refresh list:vaults')

  const vaults = await getVaultsList()

  const vaultsByChain = vaults.reduce((acc, vault) => {
    if (!acc[vault.chainId]) {
      acc[vault.chainId] = []
    }
    acc[vault.chainId].push(vault)
    return acc
  }, {} as Record<number, typeof vaults>)

  const chainIds = Object.keys(vaultsByChain).map(Number)
  const entries = chainIds.map((chainId) => ({
    key: `rest:list:vaults:${chainId}`,
    value: vaultsByChain[chainId],
  }))

  entries.push({ key: 'rest:list:vaults:all', value: vaults })

  await keyv.setMany(entries)

  console.log(`✓ Completed: ${vaults.length} vaults cached across ${chainIds.length} chains`)
  console.timeEnd('refresh list:vaults')
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
