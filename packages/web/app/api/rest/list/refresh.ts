import { cacheMSet, disconnect } from '../cache'
import { getVaultsList } from './db'

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
  const pairs: Array<[string, string]> = chainIds.map((chainId) => [
    `rest:list:vaults:${chainId}`,
    JSON.stringify({ value: vaultsByChain[chainId] }),
  ])

  pairs.push(['rest:list:vaults:all', JSON.stringify({ value: vaults })])

  await cacheMSet(pairs)

  console.log(`✓ Completed: ${vaults.length} vaults cached across ${chainIds.length} chains`)
  console.timeEnd('refresh list:vaults')
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
