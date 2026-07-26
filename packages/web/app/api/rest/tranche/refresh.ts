import { cacheMSet, disconnect } from '../cache'
import { getTrancheSystems } from './db'
import { getTrancheKey } from './redis'

/**
 * yTranche system cache refresh.
 *
 * Writes one `rest:tranche:{chainId}` entry per chain that has a tranche
 * controller. A chain with several controllers keeps the one with the most
 * tranches — the endpoint describes a single deployment per chain — and logs the
 * others so a second deployment can't be silently dropped.
 */
async function refresh(): Promise<void> {
  console.time('refresh tranche')

  const systems = await getTrancheSystems()
  const byChain = new Map<number, typeof systems[number]>()

  for (const system of systems) {
    const existing = byChain.get(system.chainId)
    if (!existing) {
      byChain.set(system.chainId, system)
      continue
    }
    const [keep, drop] = system.tranches.length > existing.tranches.length
      ? [system, existing]
      : [existing, system]
    console.warn(
      `! chain ${system.chainId} has multiple tranche controllers; ` +
      `keeping ${keep.controller} (${keep.tranches.length} tranches), skipping ${drop.controller}`,
    )
    byChain.set(system.chainId, keep)
  }

  const pairs: Array<[string, string]> = Array.from(byChain.values()).map((system) => [
    getTrancheKey(system.chainId),
    JSON.stringify({ value: system }),
  ])

  await cacheMSet(pairs)

  console.log(`✓ Completed: ${pairs.length} tranche system(s) cached`)
  console.timeEnd('refresh tranche')
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
