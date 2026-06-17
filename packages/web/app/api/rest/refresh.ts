import { cacheMSet, disconnect } from './cache'
import { getVaultsWithSnapshots } from './list/db'
import type { VaultListItem } from './list/db'
import { getSnapshotKey } from './snapshot/redis'

/**
 * Combined cache refresh.
 *
 * Fetches every vault's listing metadata AND full snapshot from the database in
 * one pass, then writes both caches:
 *  - `rest:list:vaults:{chainId}` + `rest:list:vaults:all`
 *  - `rest:snapshot:{chainId}:{address}`
 *
 * Each cache group is written as an independent, resilient MSET so one
 * oversized/failed group (e.g. an outsized `rest:list:vaults:all`) cannot
 * prevent the others from being written. Any write failure is recorded and
 * surfaced as a non-zero exit at the end, after partial data has been persisted.
 *
 * This replaces the two former scripts (`list/refresh.ts` and
 * `snapshot/refresh-snapshot.ts`), eliminating the N+1 per-vault snapshot
 * queries and the duplicate scan of `thing` + `snapshot`.
 */
async function refresh(): Promise<void> {
  console.time('refresh list+snapshot')

  let hadFailure = false

  // Resilient write: one failed/oversized group must not block the others.
  const flush = async (pairs: Array<[string, string]>, label: string): Promise<void> => {
    if (pairs.length === 0) return
    try {
      await cacheMSet(pairs)
    } catch (err) {
      hadFailure = true
      console.error(`✗ Failed to write ${label}:`, err)
    }
  }

  console.log('Fetching vaults with snapshots...')

  const vaults = await getVaultsWithSnapshots()
  const listItems: VaultListItem[] = []
  const snapshotPairs: Array<[string, string]> = []
  let snapshotCount = 0
  let listParseFailures = 0

  for (const { listItem, listError, snapshot } of vaults) {
    if (listItem) {
      listItems.push(listItem)
    } else {
      hadFailure = true
      listParseFailures++
      console.error(`✗ Failed to parse list item ${listParseFailures}:`, listError)
    }

    if (snapshot) {
      snapshotPairs.push([
        getSnapshotKey(snapshot.chainId, snapshot.address),
        JSON.stringify({ value: snapshot }),
      ])
      snapshotCount++
    }
  }

  await flush(snapshotPairs, 'snapshots')

  // --- List cache (grouped by chain + an "all" bucket) ---
  if (listParseFailures > 0) {
    console.error(`✗ Skipped list cache writes after ${listParseFailures} list parse failure(s)`)
  } else {
    const vaultsByChain = listItems.reduce((acc, vault) => {
      if (!acc[vault.chainId]) {
        acc[vault.chainId] = []
      }
      acc[vault.chainId].push(vault)
      return acc
    }, {} as Record<number, VaultListItem[]>)

    const chainIds = Object.keys(vaultsByChain).map(Number)
    const perChainPairs: Array<[string, string]> = chainIds.map((chainId) => [
      `rest:list:vaults:${chainId}`,
      JSON.stringify({ value: vaultsByChain[chainId] }),
    ])

    // Per-chain and `all` are flushed independently so an oversized `all`
    // payload cannot block the per-chain (or already-written snapshot) caches.
    await flush(perChainPairs, 'list per-chain')
    await flush(
      [['rest:list:vaults:all', JSON.stringify({ value: listItems })]],
      'list all',
    )
  }

  const chainCount = new Set(listItems.map((vault) => vault.chainId)).size

  console.log(
    `✓ Completed: ${listItems.length} vaults cached across ${chainCount} chains, ` +
    `${snapshotCount} snapshots cached`,
  )
  console.timeEnd('refresh list+snapshot')

  if (hadFailure) {
    throw new Error('one or more cache writes failed')
  }
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
