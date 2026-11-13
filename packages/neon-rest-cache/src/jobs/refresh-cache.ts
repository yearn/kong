import { getVaultsWithSnapshots } from '../../../web/app/api/rest/list/db'
import type { VaultListItem } from '../../../web/app/api/rest/list/db'
import { getSnapshotKey } from '../../../web/app/api/rest/snapshot/redis'
import { getTrancheControllers, getTrancheSystem } from '../../../web/app/api/rest/tranche/db'
import { getTrancheControllersKey, getTrancheSystemKey } from '../../../web/app/api/rest/tranche/redis'
import type { JobContext } from '../job-types'
import { mapSettledLimit, throwSettledFailures } from './concurrency'
import { stringifyCacheValue } from './json'

const TRANCHE_CONCURRENCY = 5

async function refreshVaultCache({ sourceDb, cache }: JobContext): Promise<void> {
  const vaults = await getVaultsWithSnapshots(sourceDb)
  const listItems: VaultListItem[] = []
  const snapshotPairs: Array<[string, string]> = []
  let hadParseFailure = false

  for (const { listItem, listError, snapshot } of vaults) {
    if (listItem) listItems.push(listItem)
    else {
      hadParseFailure = true
      console.error('Failed to parse a vault list item:', listError)
    }
    if (snapshot) {
      snapshotPairs.push([
        getSnapshotKey(snapshot.chainId, snapshot.address),
        stringifyCacheValue({ value: snapshot }),
      ])
    }
  }

  const groups: Array<{ pairs: Array<[string, string]>, label: string }> = [
    { pairs: snapshotPairs, label: 'snapshots' },
  ]

  if (!hadParseFailure) {
    const byChain = new Map<number, VaultListItem[]>()
    for (const item of listItems) {
      const chain = byChain.get(item.chainId) ?? []
      chain.push(item)
      byChain.set(item.chainId, chain)
    }
    groups.push({
      label: 'list per-chain',
      pairs: Array.from(byChain, ([chainId, items]) => [
        `rest:list:vaults:${chainId}`,
        stringifyCacheValue({ value: items }),
      ]),
    })
    groups.push({
      label: 'list all',
      pairs: [['rest:list:vaults:all', stringifyCacheValue({ value: listItems })]],
    })
  } else {
    console.error('Skipped list cache writes because at least one item failed validation')
  }

  const writes = await Promise.allSettled(groups.map(async ({ pairs, label }) => {
    if (pairs.length === 0) return
    try {
      await cache.setMany(pairs)
    } catch (error) {
      throw new Error(`Failed to write ${label}`, { cause: error })
    }
  }))
  throwSettledFailures(writes)
  if (hadParseFailure) throw new Error('Vault list cache was not published because an item failed validation')
}

async function refreshTrancheCache({ sourceDb, cache }: JobContext): Promise<void> {
  const controllers = await getTrancheControllers(sourceDb)
  const settledSystems = await mapSettledLimit(controllers, TRANCHE_CONCURRENCY, ({ chainId, controller }) =>
    getTrancheSystem(chainId, controller, sourceDb),
  )
  throwSettledFailures(settledSystems)
  const systems = settledSystems.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  const byChain = new Map<number, typeof systems>()
  for (const system of systems) {
    const chain = byChain.get(system.chainId) ?? []
    chain.push(system)
    byChain.set(system.chainId, chain)
  }

  const pairs: Array<[string, string]> = systems.map(system => [
    getTrancheSystemKey(system.chainId, system.controller),
    stringifyCacheValue({ value: system }),
  ])
  for (const [chainId, chainSystems] of byChain) {
    pairs.push([
      getTrancheControllersKey(chainId),
      stringifyCacheValue({ value: chainSystems }),
    ])
  }
  await cache.setMany(pairs)
}

/** Refresh vault/list/snapshot and tranche caches as one scheduled job. */
export async function refreshCache(context: JobContext): Promise<void> {
  const results = await Promise.allSettled([
    refreshVaultCache(context),
    refreshTrancheCache(context),
  ])
  throwSettledFailures(results)
}
