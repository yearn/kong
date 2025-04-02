import { Thing } from 'lib/types'
import { createPublicClient, http, zeroAddress } from 'viem'
import { yprismaAbi } from './yprisma'

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
    return gauges.find(gauge =>
      gauge.lpToken && gauge.lpToken.toLowerCase() === assetAddress.toLowerCase()
    ) || { gauge: '', swap: '' }
  }

  /**
   * Finds the pool for a vault based on asset address
   */
  static findPoolForVault(assetAddress, pools) {
    return pools.find(pool =>
      pool.lpToken && pool.lpToken.toLowerCase() === assetAddress.toLowerCase()
    ) || {}
  }

  /**
   * Finds the Frax pool for a vault based on asset address
   */
  static findFraxPoolForVault(assetAddress, fraxPools) {
    return fraxPools.find(pool =>
      pool.lpToken && pool.lpToken.toLowerCase() === assetAddress.toLowerCase()
    ) || {}
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

  /**
   * Determines the keepCRV value for a strategy
   */
  static determineCurveKeepCRV(strategy) {
    const keepValue = (strategy.keepCRV || BigInt(0))
      .plus(strategy.keepCRVPercent || BigInt(0))
    // Normalize (assuming 4 decimals)
    return keepValue / 10000n
  }

  /**
   * Calculate Curve forward APY for a strategy
   */
  static calculateCurveForwardAPY(data) {
    const { vault, gaugeAddress, strategy, baseAPY, rewardAPY, poolAPY } = data

    // Get boost from strategy or default to reasonable value
    const boost = strategy.boost || BigInt(2.5)

    // Determine keepCRV
    const keepCRV = this.determineCurveKeepCRV(strategy)

    // Calculate boosted APR
    const boostedAPR = baseAPY.times(boost)

    // Calculate net APY: (pool APY + boosted APR * (1 - keepCRV) + rewards APY)
    const netAPY = poolAPY
      .plus(boostedAPR * (1n - keepCRV))
      .plus(rewardAPY)

    return {
      type: 'Curve',
      netAPY,
      composite: {
        boost,
        poolAPY,
        boostedAPR,
        baseAPR: baseAPY,
        cvxAPR: BigInt(0),
        rewardsAPY,
        keepCRV,
        keepVelo: BigInt(0)
      }
    }
  }

  /**
   * Calculate Convex forward APY for a strategy
   */
  static calculateConvexForwardAPY(data) {
    const {
      vault,
      gaugeAddress,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY
    } = data

    // For Convex, boost is typically maxed at 2.5x
    const boost = BigInt(2.5)

    // Determine keepCRV
    const keepCRV = this.determineCurveKeepCRV(strategy)

    // Calculate CVX APR (simplified - in a real implementation this would involve more complex calculations)
    // This is a placeholder - actual CVX APR calculation would involve token prices and distribution rates
    const cvxAPR = baseAPY.times(0.3) // Example: CVX APR is approximately 30% of base APY

    // Calculate boosted APR
    const boostedAPR = baseAPY.times(boost)

    // Calculate net APY for Convex strategy
    // poolDailyAPY + (boostedAPR * (1 - keepCRV)) + cvxAPR + rewardAPY
    const netAPY = poolDailyAPY
      .plus(boostedAPR.times(BigInt(1).minus(keepCRV)))
      .plus(cvxAPR)
      .plus(rewardAPY)

    return {
      type: 'Convex',
      netAPY,
      composite: {
        boost,
        poolAPY: poolDailyAPY,
        boostedAPR,
        baseAPR: baseAPY,
        cvxAPR,
        rewardsAPY,
        keepCRV,
        keepVelo: BigInt(0)
      }
    }
  }

  /**
   * Calculate Frax forward APR for a strategy
   */
  static calculateFraxForwardAPY(data, fraxPool) {
    const {
      vault,
      gaugeAddress,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY
    } = data

    // For Frax, boost depends on the frax pool data
    // This is a simplified placeholder
    const boost = BigInt(2.0)

    // Determine keepCRV
    const keepCRV = this.determineCurveKeepCRV(strategy)

    // Frax specific APR calculation would go here
    // Placeholder with simplified logic
    const fraxAPR = baseAPY.times(0.2) // Example value

    // Calculate boosted APR
    const boostedAPR = baseAPY.times(boost)

    // Calculate net APY for Frax strategy
    const netAPY = poolDailyAPY
      .plus(boostedAPR.times(BigInt(1).minus(keepCRV)))
      .plus(fraxAPR)
      .plus(rewardAPY)

    return {
      type: 'Frax',
      netAPY,
      composite: {
        boost,
        poolAPY: poolDailyAPY,
        boostedAPR,
        baseAPR: baseAPY,
        cvxAPR: fraxAPR, // Using cvxAPR field for fraxAPR
        rewardsAPY,
        keepCRV,
        keepVelo: BigInt(0)
      }
    }
  }

  /**
   * Calculate Prisma forward APR for a strategy
   */
  static async calculatePrismaForwardAPR(data) {
    const {
      vault,
      gaugeAddress,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
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


    return {
      type: 'Prisma',
      netAPY,
      composite: {
        boost,
        poolAPY: poolDailyAPY,
        boostedAPR,
        baseAPR: baseAPY,
        cvxAPR: prismaAPR, // Using cvxAPR field for prismaAPR
        rewardsAPY,
        keepCRV,
        keepVelo: BigInt(0)
      }
    }
  }

  /**
   * Calculate strategy APR based on its type (Curve, Convex, Frax, or Prisma)
   */
  static calculateCurveLikeStrategyAPR(
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

    // TODO: findout how to calculate this
    const crvPrice = BigInt(1) // Placeholder

    // Get pool price from gauge
    const poolPrice = this.getPoolPrice(gauge)

    // Calculate base APY (simplified)
    // In a real implementation, this would use calculateGaugeBaseAPR
    const baseAPY = BigInt(0.1) // Placeholder

    // Get rewards APY
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
  static computeCurveLikeForwardAPY(
    vault: Thing,
    gauges,
    pools,
    subgraphData,
    fraxPools,
    allStrategiesForVault
  ) {
    const gauge = this.findGaugeForVault(vault.address, gauges)
    const pool = this.findPoolForVault(vault.address, pools)
    const fraxPool = this.findFraxPoolForVault(vault.address, fraxPools)
    const subgraphItem = this.findSubgraphItemForVault(gauge.swap, subgraphData)

    let typeOf = ''
    let netAPY = BigInt(0)
    let boost = BigInt(0)
    let poolAPY = BigInt(0)
    let boostedAPR = BigInt(0)
    let baseAPR = BigInt(0)
    let cvxAPR = BigInt(0)
    let rewardsAPY = BigInt(0)
    let keepCRV = BigInt(0)
    let keepVelo = BigInt(0)

    for (const strategyAddress in allStrategiesForVault) {
      const strategy = allStrategiesForVault[strategyAddress]

      if (!strategy.lastDebtRatio || strategy.lastDebtRatio.isZero()) {
        if (process.env.ENVIRONMENT === 'dev') {
          console.info(`Skipping strategy ${strategy.address} for vault ${vault.address} because debt ratio is zero`)
        }
        continue
      }

      const strategyAPR = this.calculateCurveLikeStrategyAPR(
        vault,
        strategy,
        gauge,
        pool,
        fraxPool,
        subgraphItem
      )

      typeOf += ' ' + strategyAPR.type.trim()
      netAPY = netAPY + strategyAPR.netAPY
      boost = boost + strategyAPR.composite.boost
      poolAPY = poolAPY + strategyAPR.composite.poolAPY
      boostedAPR = boostedAPR + strategyAPR.composite.boostedAPR
      baseAPR = baseAPR + strategyAPR.composite.baseAPR
      cvxAPR = cvxAPR + strategyAPR.composite.cvxAPR
      rewardsAPY = rewardsAPY + strategyAPR.composite.rewardsAPY
      keepCRV = keepCRV + strategyAPR.composite.keepCRV
      keepVelo = keepVelo + strategyAPR.composite.keepVelo
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
        keepCRV,
        keepVelo
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

  static async computeAPY(vaults: Thing[], chain: string) {
    const gauges = await this.fetchGauges(chain)
    const pools = await this.fetchPools(chain)
    const subgraph = await this.fetchSubgraph(chain)
    const fraxPools = await this.fetchFraxPools()
    for (const vault of vaults) {
      if (this.isCurveStrategy(vault)) {
        // go back to this
        return this.computeCurveLikeForwardAPY(vault, gauges, pools, subgraph, fraxPools, vault.strategies)
      }
    }
  }
}
