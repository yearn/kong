import { CrvPool } from '../types/crv-pools'
import { CrvSubgraphPool } from '../types/crv-subgraph'
import { FraxPool } from '../types/frax-pools'
import { Gauge } from '../types/gauges'
import { CURVE_SUBGRAPHDATA_URI } from './maps.helper'
import { cache } from 'lib/cache'

// API fetch functions
export async function fetchGauges(chain: string) {
  const gauges = await cache.wrap(`fetchGauges:${chain}`, async () => {
    const gaugesResponse = await fetch(
      `${process.env.CRV_GAUGE_REGISTRY_URL}?blockchainId=${chain}`
    )
    const gauges = await gaugesResponse.json()
    return Object.values(gauges.data) as Gauge[]
  }, 1000 * 60 * 5)
  return gauges
}

export async function fetchPools(chain: string) {
  const pools = await cache.wrap(`fetchPools:${chain}`, async () => {
    try {

      const poolsResponse = await fetch(
        `${process.env.CRV_POOLS_URL}/${chain}`
      )
      const pools = await poolsResponse.json()
      return pools.data?.poolData as CrvPool[]
    }catch(err) {
      console.error(err)
      return []
    }
  }, 1000 * 60 * 5)
  return pools
}

export async function fetchSubgraph(chainId:number) {
  const subgraph = await cache.wrap(`fetchSubgraph:${chainId}`, async () => {
    try {
      const subgraphResponse = await fetch(
        `${CURVE_SUBGRAPHDATA_URI[chainId]}`
      )
      const subgraph = await subgraphResponse.json()
      return subgraph.data.poolList as CrvSubgraphPool[]
    }catch(err) {
      console.error(err)
      return []
    }
  }, 1000 * 60 * 5)
  return subgraph
}

export async function fetchFraxPools() {
  const fraxPools = await cache.wrap('fetchFraxPools', async () => {
    const fraxPoolsResponse = await fetch(
      'https://frax.convexfinance.com/api/frax/pools'
    )
    const fraxPools = await fraxPoolsResponse.json()
    return fraxPools.pools.augmentedPoolData as FraxPool[]
  }, 1000 * 60 * 5)

  const pools = fraxPools.map(pool => {
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
