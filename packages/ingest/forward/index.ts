import { StrategyWithIndicators, Thing } from 'lib/types'
import { getChainByChainId } from 'lib/chains'
import { fetchFraxPools } from './helpers/crv.fetcher'
import { fetchGauges } from './helpers/crv.fetcher'
import { fetchPools } from './helpers/crv.fetcher'
import { fetchSubgraph } from './helpers/crv.fetcher'
import { isCurveStrategy, computeCurveLikeForwardAPY } from './crv-like.forward'

export interface ForwardAPY {
  netAPY: bigint
  boost: bigint
  poolAPY: bigint
  boostedAPR: bigint
  baseAPR: bigint
  rewardsAPY: bigint
  keepCRV: bigint
  cvxAPR?: bigint
}

export async function computeChainAPY(vault: Thing & { name: string }, chainId: number, strategies: StrategyWithIndicators[]) {
  const chain = getChainByChainId(chainId)?.name?.toLowerCase()


  if (!chain) return null

  const gauges = await fetchGauges(chain)
  const pools = await fetchPools(chain)
  const subgraph = await fetchSubgraph(chainId)
  const fraxPools = await fetchFraxPools()

  if (isCurveStrategy(vault)) {
    return computeCurveLikeForwardAPY({
      vault,
      gauges,
      pools,
      subgraphData: subgraph,
      fraxPools,
      allStrategiesForVault: strategies,
      chainId
    })
  }

  return null
}
