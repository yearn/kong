import { Thing } from 'lib/types'
import { computeCurveLikeForwardAPY, fetchFraxPools, fetchGauges, fetchPools, fetchSubgraph, isCurveStrategy } from './crv-like.forward'

export async function computeChainAPY(vaults: Thing[], chain: string, strategies: any) {
  const gauges = await fetchGauges(chain)
  const pools = await fetchPools(chain)
  const subgraph = await fetchSubgraph(chain)
  const fraxPools = await fetchFraxPools()

  const result = {} as Record<string, any>

  for (const vault of vaults) {
    const vaultAPY = {} as Record<string, any>

    if (isCurveStrategy(vault)) {
      vaultAPY.forwardAPY = await computeCurveLikeForwardAPY(vault, gauges, pools, subgraph, fraxPools, strategies, chain)
    }

    result[vault.address] = vaultAPY
  }
  return result
}
