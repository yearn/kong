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

  /**
   * Checks if the strategy is a Convex strategy based on name
   */
  static isConvexStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('convex')
  }

  /**
   * Checks if the strategy is a Frax strategy based on name
   */
  static isFraxStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('frax')
  }

  /**
   * Checks if the strategy is a Prisma strategy based on name
   */
  static isPrismaStrategy(strategy) {
    const strategyName = strategy.name.toLowerCase()
    return strategyName.includes('prisma')
  }

  /**
   * Finds the gauge for a vault based on asset address
   */
  static findGaugeForVault(assetAddress, gauges) {
    return gauges.find((gauge) => {
      if(gauge.swapToken === assetAddress) {
        return gauge
      }
    })
  }

  /**
   * Finds the pool for a vault based on asset address
   */
  static findPoolForVault(assetAddress, pools) {
    return pools.find((pool) => {
      if(pool.LPTokenAddress === assetAddress) {
        return pool
      }
    })
  }

  /**
   * Finds the Frax pool for a vault based on asset address
   */
  static findFraxPoolForVault(assetAddress, fraxPools) {
    return fraxPools.find((pool) => {
      if(pool.underlyingTokenAddress === assetAddress) {
        return pool
      }
    })
  }

  /**
   * Finds the subgraph item for a vault based on gauge swap address
   */
  static findSubgraphItemForVault(swapAddress, subgraphData) {
    return subgraphData.find(item =>
      item.address && item.address.toLowerCase() === swapAddress.toLowerCase()
    ) || { latestWeeklyApy: 0, latestDailyApy: 0 }
  }

  /**
   * Gets the pool weekly APY from subgraph data
   */
  static getPoolWeeklyAPY(subgraphItem) {
    return BigInt(subgraphItem.latestWeeklyApy || 0) / 100n
  }

  /**
   * Gets the pool daily APY from subgraph data
   */
  static getPoolDailyAPY(subgraphItem) {
    return BigInt(subgraphItem.latestDailyApy || 0) / 100n
  }

  /**
   * Gets the pool price from gauge data
   */
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

  /**
   * Gets rewards APY from pool data
   */
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

  /**
   * Determines the keepCRV value for a strategy
   */
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return BigInt(cvxKeepCRV as any)
      } catch (e) {
        const localKeepCRV = await client.readContract({
          address: strategy.address,
          abi: convexBaseStrategyAbi,
          functionName: 'LocalKeepCRV',
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    return keepCRV
  }

  /**
   * Calculate Curve forward APY for a strategy
   */
  static async calculateCurveForwardAPY(data) {
    const chainId = data.chainId
    const yboost = await getCurveBoost(chainId, YEARN_VOTER_ADDRESS[chainId], data.gaugeAddress)

    const keepCrv = await this.determineCurveKeepCRV(data.strategy, chainId)
    const debtRatio = data.lastDebtRatio
    const performanceFee = data.strategy.performanceFee
    const managementFee = data.strategy.managementFee
    const oneMinusPerfFee = BigInt(1) - BigInt(performanceFee)

    let crvAPY = data.baseAPY * BigInt(yboost)
    crvAPY = crvAPY + data.rewardAPY

    const keepCRVRatio = BigInt(1) + BigInt(keepCrv as any)
    let grossAPY = data.baseAPY * BigInt(yboost)
    grossAPY = grossAPY * keepCRVRatio
    grossAPY = grossAPY + data.rewardAPY
    grossAPY = grossAPY + data.poolAPY

    let netAPY = grossAPY + oneMinusPerfFee

    if(netAPY > managementFee) {
      netAPY = netAPY - managementFee
    }else {
      netAPY = BigInt(0)
    }

    return {
      type: 'curve',
      debtRatio,
      netAPY,
      boost: BigInt(yboost) * BigInt(debtRatio),
      poolAPY: data.poolAPY * debtRatio,
      boostedAPR: crvAPY * debtRatio,
      baseAPR: data.baseAPY * debtRatio,
      rewardsAPY: data.rewardAPY * debtRatio,
      keepCRV: keepCrv
    }
  }

  /**
   * Calculate Convex forward APY for a strategy
   */
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

    // Determine keepCRV
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

  /**
   * Calculate Frax forward APR for a strategy
   */
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

  /**
   * Calculate Prisma forward APR for a strategy
   */
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

  /**
   * Calculate strategy APR based on its type (Curve, Convex, Frax, or Prisma)
   */
  static async calculateCurveLikeStrategyAPR(
    vault: Thing,
    strategy,
    gauge,
    pool,
    fraxPool,
    subgraphItem,
    chainId
  ) {
    // Get base asset price from gauge
    const baseAssetPrice = BigInt(gauge.lpTokenPrice || 0)

    const { priceUsd } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
    const crvPrice = BigInt(priceUsd)

    // Get pool price from gauge
    const poolPrice = this.getPoolPrice(gauge)

    const { baseAPY } = await this.calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)

    const rewardAPY = this.getRewardsAPY(chainId, pool)

    // Get pool APYs
    const poolWeeklyAPY = this.getPoolWeeklyAPY(subgraphItem)
    const poolDailyAPY = this.getPoolDailyAPY(subgraphItem)

    // Determine which strategy type to calculate
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

  /**
   * If the vault is a curve vault, a convex vault or a frax vault, we can calculate the forward APR
   * for it, using always the same base formula, which require fetching some elements like:
   * - The gauge
   * - The pool
   * - The subgraph data
   * - The frax pool
   */
  static async computeCurveLikeForwardAPY(
    vault: Thing,
    gauges,
    pools,
    subgraphData,
    fraxPools,
    allStrategiesForVault,
    chainId
  ) {
    const gauge = this.findGaugeForVault(vault.address, gauges)
    const pool = this.findPoolForVault(vault.address, pools)
    const fraxPool = this.findFraxPoolForVault(vault.address, fraxPools)
    const subgraphItem = this.findSubgraphItemForVault(gauge.swap, subgraphData)

    let typeOf = ''
    let netAPY = 0
    let boost = 0
    let poolAPY = 0
    let boostedAPR = 0
    let baseAPR = 0
    let cvxAPR = 0
    let rewardsAPY = 0
    let keepCRV = 0

    for (const strategyAddress in allStrategiesForVault) {
      const strategy = allStrategiesForVault[strategyAddress]

      if (!strategy.lastDebtRatio || strategy.lastDebtRatio.isZero()) {
        continue
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

      if(!strategyAPR) {
        continue
      }

      typeOf += ' ' + strategyAPR.type.trim()
      netAPY = netAPY + Number(strategyAPR.netAPY)
      boost = boost + Number(strategyAPR.boost)
      poolAPY = poolAPY + Number(strategyAPR.poolAPY)
      boostedAPR = boostedAPR + Number(strategyAPR.boostedAPR)
      baseAPR = baseAPR + Number(strategyAPR.baseAPR)
      cvxAPR = cvxAPR + ('cvxAPR' in strategyAPR ? Number(strategyAPR.cvxAPR) : 0)
      rewardsAPY = rewardsAPY + Number(strategyAPR.rewardsAPY)
      keepCRV = keepCRV + ('keepCRV' in strategyAPR ? Number(strategyAPR.keepCRV) : 0)
    }

    return {
      type: typeOf.trim(),
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
