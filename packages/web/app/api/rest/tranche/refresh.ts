import { cronDb } from '../../db/cron'
import { cacheMSet } from '../cache'
import { getTrancheSystems } from './db'
import { getTrancheControllersKey, getTrancheSystemKey } from './redis'

/**
 * yTranche system cache refresh.
 *
 * A controller is asset-class-bound by construction — ASSET and VAULT are
 * constructor arguments with no setters — so a chain holds one controller per
 * asset class, not one controller. Every controller found gets its own
 * `rest:tranche:{chainId}:{controller}` entry, and each chain gets a
 * `rest:tranche:{chainId}:controllers` collection holding all of them.
 */
export async function refreshTranches(): Promise<void> {
  console.time('refresh tranche')

  const systems = await getTrancheSystems(cronDb)

  const byChain = new Map<number, typeof systems>()
  for (const system of systems) {
    const chain = byChain.get(system.chainId) ?? []
    chain.push(system)
    byChain.set(system.chainId, chain)
  }

  const pairs: Array<[string, string]> = []

  for (const system of systems) {
    pairs.push([
      getTrancheSystemKey(system.chainId, system.controller),
      JSON.stringify({ value: system }),
    ])
  }

  for (const [chainId, chainSystems] of Array.from(byChain.entries())) {
    pairs.push([
      getTrancheControllersKey(chainId),
      JSON.stringify({ value: chainSystems }),
    ])
  }

  await cacheMSet(pairs)

  for (const [chainId, chainSystems] of Array.from(byChain.entries())) {
    console.log(`  chain ${chainId}: ${chainSystems.map((system) =>
      `${system.asset.symbol ?? system.asset.address} (${system.tranches.length} tranches)`).join(', ')}`)
  }

  console.log(`✓ Completed: ${systems.length} tranche system(s) across ${byChain.size} chain(s)`)
  console.timeEnd('refresh tranche')
}

