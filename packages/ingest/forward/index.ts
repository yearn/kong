import { StrategyWithIndicators, Thing } from 'lib/types'
import { getChainByChainId } from 'lib/chains'
import { fetchFraxPools } from './helpers/crv.fetcher'
import { fetchGauges } from './helpers/crv.fetcher'
import { fetchPools } from './helpers/crv.fetcher'
import { fetchSubgraph } from './helpers/crv.fetcher'
import { isCurveStrategy, computeCurveLikeForwardAPY } from './crv-like.forward'
import { isV3Vault } from './helpers/general'
import { computeV3ForwardAPY } from './v3.forward'
import { computeV2ForwardAPY } from './v2.forward'

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
  let vaultAPY

  if (isCurveStrategy(vault)) {
    vaultAPY = await computeCurveLikeForwardAPY({
      vault,
      gauges,
      pools,
      subgraphData: subgraph,
      fraxPools,
      allStrategiesForVault: strategies,
      chainId
    })
  }

  if(isV3Vault(vault)) {
    vaultAPY = await computeV3ForwardAPY(vault, strategies, chainId)
  }else {
    vaultAPY = await computeV2ForwardAPY(vault)
  }

  return vaultAPY

}
