import { Thing } from 'lib/types'
import { createPublicClient, http, zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../prices'
import { convertFloatAPRToAPY } from './calculation.helper'
import { convexBaseStrategyAbi } from './convex-base-strategy.abi'
import { crvRewardsAbi } from './crv-rewards.abi'
import { getCurveBoost } from './crv.helper'
import { cvxBoosterAbi } from './cvx-booster.abi'
import { getConvexRewardAPY, getCVXForCRV } from './cvx.helper'
import { CRV_TOKEN_ADDRESS, CVX_TOKEN_ADDRESS, YEARN_VOTER_ADDRESS } from './maps.helper'
import { getPrismaAPY } from './prisma.helper'
import { yprismaAbi } from './yprisma.abi'
import { yStrategyAbi } from './ystrategy.abi'

export class ApiCalculator {
  static isCurveStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return (
      (strategyName.includes('curve') || strategyName.includes('convex')) &&
      !strategyName.includes('ajna-')
    )
  }

  static isConvexStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('convex')
  }

  static isFraxStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('frax')
  }

  static isPrismaStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('prisma')
  }

  static findGaugeForVault(assetAddress, gauges) {
    return gauges.find((gauge) => {
      if(gauge.swapToken === assetAddress) {
        return gauge
      }
    })
  }

  static findPoolForVault(assetAddress, pools) {
    return pools.find((pool) => {
      if(pool.LPTokenAddress === assetAddress) {
        return pool
      }
    })
  }

  static findFraxPoolForVault(assetAddress, fraxPools) {
    return fraxPools.find((pool) => {
      if(pool.underlyingTokenAddress === assetAddress) {
        return pool
      }
    })
  }

  static findSubgraphItemForVault(swapAddress, subgraphData) {
    return subgraphData.find(item =>
      item.address && item.address.toLowerCase() === swapAddress.toLowerCase()
    ) || { latestWeeklyApy: 0, latestDailyApy: 0 }
  }

  static getPoolWeeklyAPY(subgraphItem) {
    return BigInt(subgraphItem.latestWeeklyApy || 0) / 100n
  }

  static getPoolDailyAPY(subgraphItem) {
    return BigInt(subgraphItem.latestDailyApy || 0) / 100n
  }

  static getPoolPrice(gauge) {
    let virtualPrice = BigInt(0)
    if (gauge.swapData && gauge.swapData.virtualPrice) {
      if (typeof gauge.swapData.virtualPrice === 'string') {
        virtualPrice = BigInt(gauge.swapData.virtualPrice)
      } else if (typeof gauge.swapData.virtualPrice === 'number') {
        virtualPrice = BigInt(gauge.swapData.virtualPrice)
      }
    }
    const divisor = 10n**18n
    return virtualPrice / divisor
  }

  static getRewardsAPY(chainId, pool) {
    let totalRewardAPR = BigInt(0)
    if (!pool.gaugeRewards || pool.gaugeRewards.length === 0) {
      return totalRewardAPR
    }

    for (const reward of pool.gaugeRewards) {
      const rewardAPR = BigInt(reward.APY || 0) / 100n
      totalRewardAPR = totalRewardAPR + rewardAPR
    }
    return totalRewardAPR
  }

  static async getCVXPoolAPY(chainId, strategyAddress, baseAssetPrice) {
    const client = createPublicClient({
      transport: http(process.env[`RPC_FULL_NODE_${chainId}`])
    })

    const rewardPID = await client.readContract({
      address: strategyAddress,
      abi: convexBaseStrategyAbi,
      functionName: 'PID',
    })

    const poolInfo = await client.readContract({
      address: strategyAddress,
      abi: cvxBoosterAbi,
      functionName: 'poolInfo',
      args: [rewardPID],
    }) as any

    const rateResult = await client.readContract({
      address: poolInfo.crvRewards,
      abi: crvRewardsAbi,
      functionName: 'rewardRate',
    }) as any

    const totalSupply = await client.readContract({
      address: poolInfo.crvRewards,
      abi: crvRewardsAbi,
      functionName: 'totalSupply',
    }) as any

    const rate = Number(rateResult)
    const supply = Number(totalSupply)
    const virtualSupply = supply * baseAssetPrice
    let crvPerUnderlying

    if(virtualSupply > 0) {
      crvPerUnderlying = rate / virtualSupply
    }

    const crvPerUnderlyingPerYear = crvPerUnderlying * 31536000
    const cvxPerYear = await getCVXForCRV(chainId, BigInt(crvPerUnderlyingPerYear))

    const { priceUsd: crvPrice } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)

    const { priceUsd: cvxPrice } = await fetchErc20PriceUsd(chainId, CVX_TOKEN_ADDRESS[chainId], undefined, true)

    const crvAPR = crvPerUnderlyingPerYear * crvPrice
    const cvxAPR = Number(cvxPerYear) * cvxPrice

    const crvAPY = convertFloatAPRToAPY(BigInt(crvAPR), 365/15)
    const cvxAPY = convertFloatAPRToAPY(BigInt(cvxAPR), 365/15)

    return {
      crvAPR,
      cvxAPR,
      crvAPY,
      cvxAPY
    }
  }

  static async determineCurveKeepCRV(strategy, chainId) {
    const client = createPublicClient({
      transport: http(process.env[`RPC_FULL_NODE_${chainId}`])
    })

    const useLocalCRV = await client.readContract({
      address: strategy.address,
      abi: convexBaseStrategyAbi,
      functionName: 'uselLocalCRV',
    })

    if(useLocalCRV) {
      try {
        const cvxKeepCRV = await client.readContract({
          address: strategy.address,
          abi: convexBaseStrategyAbi,
          functionName: 'localCRV',
        })
        return BigInt(cvxKeepCRV as any)
      } catch (e) {
        const localKeepCRV = await client.readContract({
          address: strategy.address,
          abi: convexBaseStrategyAbi,
          functionName: 'LocalKeepCRV',
        })
        return BigInt(localKeepCRV as any)
      }
    }

    const crvGlobal = await client.readContract({
      address: strategy.address,
      abi: convexBaseStrategyAbi,
      functionName: 'curveGlobal',
    })

    const keepCRV = await client.readContract({
      address: crvGlobal as `0x${string}`,
      abi: yStrategyAbi,
      functionName: 'keepCRV',
    })

    return BigInt(keepCRV as string)
  }

  static async calculateCurveForwardAPY(data) {
    const chainId = data.chainId
    const yboost = await getCurveBoost(chainId, YEARN_VOTER_ADDRESS[chainId], data.gaugeAddress)

    const keepCrv = await this.determineCurveKeepCRV(data.strategy, chainId)
    const debtRatio = data.lastDebtRatio
    const performanceFee = data.strategy.performanceFee
    const managementFee = data.strategy.managementFee
    const oneMinusPerfFee = 1 - performanceFee

    let crvAPY = data.baseAPY * yboost
    crvAPY = crvAPY + data.rewardAPY

    const keepCRVRatio = 1 + Number(keepCrv)
    let grossAPY = data.baseAPY * yboost
    grossAPY = grossAPY * keepCRVRatio
    grossAPY = grossAPY + data.rewardAPY
    grossAPY = grossAPY + data.poolAPY

    let netAPY = grossAPY + oneMinusPerfFee

    if(netAPY > managementFee) {
      netAPY = netAPY - managementFee
    }else {
      netAPY = 0
    }

    return {
      type: 'curve',
      debtRatio,
      netAPY,
      boost: yboost * debtRatio,
      poolAPY: data.poolAPY * debtRatio,
      boostedAPR: crvAPY * debtRatio,
      baseAPR: data.baseAPY * debtRatio,
      rewardsAPY: data.rewardAPY * debtRatio,
      keepCRV: keepCrv
    }
  }

  static async calculateConvexForwardAPY(data) {
    const {
      gaugeAddress,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
      chainId,
      lastDebtRatio
    } = data

    const cvxBoost = await getCurveBoost(chainId, gaugeAddress, strategy.address)

    const keepCRV = await this.determineCurveKeepCRV(strategy, chainId)

    const debtRatio = lastDebtRatio
    const performanceFee = strategy.performanceFee
    const managementFee = strategy.managementFee
    const oneMinusPerfFee = 1 - performanceFee

    const {crvAPR, cvxAPR, crvAPY, cvxAPY } = await this.getCVXPoolAPY(chainId, strategy.address, baseAssetPrice)

    const {totalRewardsAPY} = await getConvexRewardAPY(chainId, strategy.address, baseAssetPrice, poolPrice)
    const keepCRVRatio = 1 - Number(keepCRV)
    let grossApy = crvAPY * keepCRVRatio
    grossApy = grossApy + rewardAPY + poolDailyAPY + cvxAPY

    let netApy = grossApy * oneMinusPerfFee
    if (netApy > managementFee) {
      netApy = netApy - managementFee
    }else {
      netApy = 0
    }
    const payload = {
      type: 'convex',
      debtRatio,
      netAPY: netApy * debtRatio,
      boost: cvxBoost * debtRatio,
      boostedAPR: crvAPR * debtRatio,
      baseAPR: baseAPY * debtRatio,
      cvxAPR: cvxAPR * debtRatio,
      rewardsAPY: totalRewardsAPY * debtRatio,
      keepCRV,
      rewardAPY: rewardAPY * debtRatio,
      poolAPY: poolDailyAPY * debtRatio,
    }

    return payload
  }

  static async calculateFraxForwardAPY(data, fraxPool) {
    const baseConvexStrategyData = await this.calculateConvexForwardAPY(data)
    const minRewardsAPR = fraxPool.totalRewardsAPR.min

    return {
      type: 'frax',
      netAPY: baseConvexStrategyData.netAPY + minRewardsAPR,
      debtRatio: baseConvexStrategyData.debtRatio,
      boost: baseConvexStrategyData.boost,
      poolAPY: baseConvexStrategyData.poolAPY,
      boostedAPR: baseConvexStrategyData.boostedAPR,
      baseAPR: baseConvexStrategyData.baseAPR,
      cvxAPR: baseConvexStrategyData.cvxAPR,
      rewardsAPY: baseConvexStrategyData.rewardsAPY + minRewardsAPR,
      keepCRV: baseConvexStrategyData.keepCRV,
    }
  }

  static async calculatePrismaForwardAPR(data) {
    const {
      vault,
      chainId
    } = data

    const client = createPublicClient({
      transport: http(process.env[`RPC_FULL_NODE_${chainId}`])
    })

    const [receiver] = await client.readContract({
      address: vault.address,
      abi: yprismaAbi,
      functionName: 'prismaReceiver',
    })

    if (receiver === zeroAddress) {
      return null
    }

    const baseConvexStrategyData = await this.calculateConvexForwardAPY(data)

    const [, prismaAPY] = await getPrismaAPY(chainId, receiver)

    return {
      type: 'prisma',
      debtRatio: baseConvexStrategyData.debtRatio,
      netAPY: baseConvexStrategyData.netAPY + prismaAPY,
      boost: baseConvexStrategyData.boost,
      poolAPY: baseConvexStrategyData.poolAPY,
      boostedAPR: baseConvexStrategyData.boostedAPR,
      baseAPR: baseConvexStrategyData.baseAPR,
      cvxAPR: baseConvexStrategyData.cvxAPR,
      rewardsAPY: baseConvexStrategyData.rewardsAPY + prismaAPY,
    }
  }

  static async calculateGaugeBaseAPR(gauge, crvTokenPrice, poolPrice, baseAssetPrice) {
    const inflationRate = gauge.inflationRate
    const gaugeWeight = gauge.relativeWeight
    const secondPerYear = 31556952
    const workingSupply = gauge.workingSupply
    const perMaxBoost = 0.4

    let baseAPR = inflationRate * gaugeWeight
    baseAPR = baseAPR * (secondPerYear / workingSupply)
    baseAPR = baseAPR * (perMaxBoost / poolPrice)
    baseAPR = baseAPR * crvTokenPrice
    baseAPR = baseAPR / baseAssetPrice

    const baseAPY = convertFloatAPRToAPY(BigInt(baseAPR), 365/15)

    return { baseAPR, baseAPY }
  }

  static async calculateCurveLikeStrategyAPR(
    vault: Thing,
    strategy,
    gauge,
    pool,
    fraxPool,
    subgraphItem,
    chainId
  ): Promise<{
      type: string;
      netAPY: number;
      boost: number;
      poolAPY: number;
      boostedAPR: number;
      baseAPR: number;
      rewardsAPY: number;
      cvxAPR?: number;
      keepCRV?: bigint;
    } | null > {
    const baseAssetPrice = BigInt(gauge.lpTokenPrice || 0)

    const { priceUsd } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
    const crvPrice = BigInt(priceUsd)

    const poolPrice = this.getPoolPrice(gauge)

    const { baseAPY } = await this.calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)

    const rewardAPY = this.getRewardsAPY(chainId, pool)

    const poolWeeklyAPY = this.getPoolWeeklyAPY(subgraphItem)
    const poolDailyAPY = this.getPoolDailyAPY(subgraphItem)

    if (this.isPrismaStrategy(strategy)) {
      return this.calculatePrismaForwardAPR({
        vault,
        gaugeAddress: gauge.gauge,
        strategy,
        baseAssetPrice,
        poolPrice,
        baseAPY,
        rewardAPY,
        poolDailyAPY
      })
    }

    if (this.isFraxStrategy(strategy)) {
      return this.calculateFraxForwardAPY({
        vault,
        gaugeAddress: gauge.gauge,
        strategy,
        baseAssetPrice,
        poolPrice,
        baseAPY,
        rewardAPY,
        poolDailyAPY
      }, fraxPool)
    }

    if (this.isConvexStrategy(strategy)) {
      return this.calculateConvexForwardAPY({
        vault,
        gaugeAddress: gauge.gauge,
        strategy,
        baseAssetPrice,
        poolPrice,
        baseAPY,
        rewardAPY,
        poolDailyAPY
      })
    }

    return this.calculateCurveForwardAPY({
      vault,
      gaugeAddress: gauge.gauge,
      strategy,
      baseAPY,
      rewardAPY,
      poolAPY: poolWeeklyAPY
    })
  }

  static async computeCurveLikeForwardAPY(
    vault: Thing,
    gauges: any[],
    pools: any[],
    subgraphData: any[],
    fraxPools: any[],
    allStrategiesForVault: Record<string, any>,
    chainId: string
  ) {
    const gauge = this.findGaugeForVault(vault.address, gauges)
    if (!gauge) {
      return { type: '', netAPY: 0, composite: {} }
    }

    const pool = this.findPoolForVault(vault.address, pools)
    const fraxPool = this.findFraxPoolForVault(vault.address, fraxPools)
    const subgraphItem = this.findSubgraphItemForVault(gauge.swap, subgraphData)

    type StrategyResult = {
      type: string;
      netAPY: number;
      boost: number;
      poolAPY: number;
      boostedAPR: number;
      baseAPR: number;
      rewardsAPY: number;
      cvxAPR?: number;
      keepCRV?: number;
    };

    const strategyResults = await Promise.all(
      Object.entries(allStrategiesForVault)
        .map(async ([, strategy]) => {
          if (!strategy.lastDebtRatio || strategy.lastDebtRatio.isZero()) {
            return null
          }

          const strategyAPR = await this.calculateCurveLikeStrategyAPR(
            vault,
            strategy,
            gauge,
            pool,
            fraxPool,
            subgraphItem,
            chainId
          )

          return strategyAPR
        })
    )

    const validResults = strategyResults.filter(Boolean) as StrategyResult[]

    if (validResults.length === 0) {
      return { type: '', netAPY: 0, composite: {} }
    }

    const types = validResults.map(result => result.type.trim()).join(' ')

    const netAPY = validResults.reduce((sum, result) => sum + Number(result.netAPY), 0)
    const boost = validResults.reduce((sum, result) => sum + Number(result.boost), 0)
    const poolAPY = validResults.reduce((sum, result) => sum + Number(result.poolAPY), 0)
    const boostedAPR = validResults.reduce((sum, result) => sum + Number(result.boostedAPR), 0)
    const baseAPR = validResults.reduce((sum, result) => sum + Number(result.baseAPR), 0)
    const cvxAPR = validResults.reduce((sum, result) =>
      sum + (result.cvxAPR !== undefined ? Number(result.cvxAPR) : 0), 0)
    const rewardsAPY = validResults.reduce((sum, result) => sum + Number(result.rewardsAPY), 0)
    const keepCRV = validResults.reduce((sum, result) =>
      sum + (result.keepCRV !== undefined ? Number(result.keepCRV) : 0), 0)

    return {
      type: types.trim(),
      netAPY,
      composite: {
        boost,
        poolAPY,
        boostedAPR,
        baseAPR,
        cvxAPR,
        rewardsAPY,
        keepCRV
      }
    }
  }

  static async fetchGauges(chain: string) {
    const gaugesResponse = await fetch(
      `${process.env.CRV_GAUGE_REGISTRY_URL}?blockchainId=${chain}`
    )
    const gauges = await gaugesResponse.json()
    return gauges.data
  }

  static async fetchPools(chain: string) {
    const poolsResponse = await fetch(
      `${process.env.CRV_POOLS_URL}/${chain}`
    )
    const pools = await poolsResponse.json()
    return pools.data
  }

  static async fetchSubgraph(chain: string) {
    const subgraphResponse = await fetch(
      `${process.env.CRV_SUBGRAPH_URL}/${chain}`
    )
    const subgraph = await subgraphResponse.json()
    return subgraph.data
  }

  static async fetchFraxPools() {
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

    return pools.filter(pool => pool !== null)
  }

  static async computeAPY(vaults: Thing[], chain: string, strategies: any) {
    const gauges = await this.fetchGauges(chain)
    const pools = await this.fetchPools(chain)
    const subgraph = await this.fetchSubgraph(chain)
    const fraxPools = await this.fetchFraxPools()

    const result = {} as Record<string, any>

    for (const vault of vaults) {
      const vaultAPY = {} as Record<string, any>

      if (this.isCurveStrategy(vault)) {
        vaultAPY.forwardAPY = await this.computeCurveLikeForwardAPY(vault, gauges, pools, subgraph, fraxPools, strategies, chain)
      }

      result[vault.address] = vaultAPY
    }
    return result
  }
}
