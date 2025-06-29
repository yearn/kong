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
import { getSnapshot } from 'lib/queries/snapshot'

export interface VaultAPY {
  type?: string;
  netAPR?: number;
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

export async function computeChainAPY(vault: Thing & { name: string }, chainId: number, strategies: StrategyWithIndicators[]) {
  const snapshot = await getSnapshot(chainId, vault.address)
  const chain = getChainByChainId(chainId)?.name?.toLowerCase()
  if (!chain) return null
  const gauges = await fetchGauges(chain)
  const pools = await fetchPools(chain)
  const subgraph = await fetchSubgraph(chainId)
  const fraxPools = await fetchFraxPools()
  let vaultAPY: VaultAPY = {}

  if(isV3Vault(vault)) {
    vaultAPY = await computeV3ForwardAPY({
      strategies,
      chainId,
      snapshot
    })
  }else {
    vaultAPY = await computeV2ForwardAPY(vault)
  }

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
    return vaultAPY
  }


  return null

}
