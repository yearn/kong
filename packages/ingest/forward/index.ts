import { StrategyWithIndicators, Thing } from 'lib/types'
import { getChainByChainId } from 'lib/chains'
import { fetchFraxPools } from './helpers/crv.fetcher'
import { fetchGauges } from './helpers/crv.fetcher'
import { fetchPools } from './helpers/crv.fetcher'
import { fetchSubgraph } from './helpers/crv.fetcher'
import { isCurveStrategy, computeCurveLikeForwardAPY } from './crv-like.forward'
import { isV3Vault } from './helpers/general'
import { computeCurrentV3VaultAPY, computeV3ForwardAPY } from './v3.forward'
import { computeV2ForwardAPY } from './v2.forward'

export interface ForwardAPY {
  type: string;
  netAPY?: number;
  boost?: number;
  poolAPY?: number;
  boostedAPR?: number;
  baseAPR?: number;
  cvxAPR?: number;
  rewardsAPY?: number;
  keepCRV?: number;
  v3OracleCurrentAPR?: number;
  v3OracleStratRatioAPR?: number;
}

export interface VaultAPY {
  type?: string;
  netAPY?: number;
  fees?: {
    performance: number;
    management: number;
  };
  points?: {
    weekAgo: number;
    monthAgo: number;
    inception: number;
  };
  pricePerShare?: {
    today: number;
    weekAgo: number;
    monthAgo: number;
  };
  forwardAPY?: ForwardAPY
}

export async function computeChainAPY(vault: Thing & { name: string }, chainId: number, strategies: StrategyWithIndicators[]) {
  const chain = getChainByChainId(chainId)?.name?.toLowerCase()
  if (!chain) return null
  const gauges = await fetchGauges(chain)
  const pools = await fetchPools(chain)
  const subgraph = await fetchSubgraph(chainId)
  const fraxPools = await fetchFraxPools()
  let vaultAPY: VaultAPY = {}

  // TODO: integrate this with future CMS to retrieve vault metadata
  const shouldUseV2APR = false

  if(isV3Vault(vault)) {
    if(shouldUseV2APR) {
      vaultAPY = await computeV2ForwardAPY(vault)
    } else {
      vaultAPY = await computeCurrentV3VaultAPY(vault)
    }

    vaultAPY.forwardAPY = await computeV3ForwardAPY(vault, strategies, chainId)
  }else {
    vaultAPY = await computeV2ForwardAPY(vault)
  }

  if (isCurveStrategy(vault)) {
    vaultAPY.forwardAPY = await computeCurveLikeForwardAPY({
      vault,
      gauges,
      pools,
      subgraphData: subgraph,
      fraxPools,
      allStrategiesForVault: strategies,
      chainId
    })
    return vaultAPY
  }


  return null

}
