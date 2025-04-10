import { CrvPool } from '../types/crv-pools'
import { CrvSubgraphPool } from '../types/crv-subgraph'
import { FraxPool } from '../types/frax-pools'
import { Gauge } from '../types/gauges'
import { CURVE_SUBGRAPHDATA_URI } from './maps.helper'

// API fetch functions
export async function fetchGauges(chain: string) {
  const gaugesResponse = await fetch(
    `${process.env.CRV_GAUGE_REGISTRY_URL}?blockchainId=${chain}`
  )
  const gauges = await gaugesResponse.json()
  return gauges.data as Gauge[]
}

export async function fetchPools(chain: string) {
  const poolsResponse = await fetch(
    `${process.env.CRV_POOLS_URL}/${chain}`
  )
  const pools = await poolsResponse.json()
  return pools.data?.poolData as CrvPool[]
}

export async function fetchSubgraph(chainId:number) {
  const subgraphResponse = await fetch(
    `${CURVE_SUBGRAPHDATA_URI[chainId]}`
  )
  const subgraph = await subgraphResponse.json()
  return subgraph.data.poolList as CrvSubgraphPool[]
}

export async function fetchFraxPools() {
  const FRAX_POOL_API_URI = 'https://frax.convexfinance.com/api/frax/pools'
  const fraxPoolsResponse = await fetch(
    FRAX_POOL_API_URI
  )
  const fraxPools = await fraxPoolsResponse.json()

  const pools = fraxPools.pools.augumentedPoolData.map(pool => {
    if(pool.type !== 'convex') {
      return null
    }
    const poolUsd = pool.stakingTokenUsdPrice

    const poolPrice = typeof poolUsd === 'string' ? parseFloat(poolUsd) : poolUsd
    pool.stakingTokenUsdPrice = poolPrice

    pool.rewardCoins = pool.rewardCoins.map((coin, index) => {
      const rewardApr = parseFloat(pool.rewardAprs[index])
      const minBoostedRewardApr = parseFloat(pool.boostedRewardAprs[index].min)
      const maxBoostedRewardApr = parseFloat(pool.boostedRewardAprs[index].max)

      return {
        rewardApr,
        minBoostedRewardApr,
        maxBoostedRewardApr
      }
    })

    return pool
  })

  return pools.filter(pool => pool !== null) as FraxPool[]
}
