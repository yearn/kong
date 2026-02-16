import { getVaultsList } from './db'
import { getListKey } from './redis'
import { keyv } from '../cache'

async function refresh(): Promise<void> {
  console.time('refresh')

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
    key: getListKey(String(chainId)),
    value: vaultsByChain[chainId],
  }))

  entries.push({ key: getListKey('all'), value: vaults })

  await (keyv as any).setMany(entries)

  console.log(`✓ Completed: ${vaults.length} vaults cached across ${chainIds.length} chains`)
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
