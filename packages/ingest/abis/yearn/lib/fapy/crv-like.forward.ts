import { StrategyWithIndicators, Thing } from 'lib/types'
import { zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../../../../../prices'
import {
  convexBaseStrategyAbi,
  crvRewardsAbi,
  cvxBoosterAbi,
  yprismaAbi
} from './abis'
import {
  convertFloatAPRToAPY,
  CRV_TOKEN_ADDRESS, CVX_BOOSTER_ADDRESS, CVX_TOKEN_ADDRESS,
  determineConvexKeepCRV,
  getConvexRewardAPY,
  getCurveBoost,
  getCVXForCRV,
  getPrismaAPY, YEARN_VOTER_ADDRESS
} from './helpers/index'
import { Gauge } from './types/gauges'
import { CrvPool } from './types/crv-pools'
import { CrvSubgraphPool } from './types/crv-subgraph'
import { FraxPool } from './types/frax-pools'
import { rpcs } from 'lib/rpcs'
import { YEARN_VAULT_ABI_04, YEARN_VAULT_V022_ABI, YEARN_VAULT_V030_ABI } from './abis/0xAbis.abi'
import { Float } from './helpers/bignumber-float'
import { BigNumberInt, toNormalizedAmount } from './helpers/bignumber-int'
import { CVXPoolInfo } from './types/cvx'
import { getErrorMessage } from 'lib'
// Strategy type detection functions
export function isCurveStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
  return (
    (vaultName?.includes('curve') || vaultName?.includes('convex') || vaultName?.includes('crv')) &&
    !vaultName?.includes('ajna-')
  )
}

export function isConvexStrategy(strategy: StrategyWithIndicators) {
  const strategyName = strategy.name.toLowerCase()
  // More specific detection to match Go logic
  return strategyName.includes('convex') && !strategyName.includes('curve')
}

export function isFraxStrategy(strategy: StrategyWithIndicators) {
  const vaultName = strategy?.name.toLowerCase()
  return vaultName?.includes('frax')
}

export function isPrismaStrategy(strategy: StrategyWithIndicators) {
  const vaultName = strategy?.name.toLowerCase()
  return vaultName?.includes('prisma')
}

// Find functions
export function findGaugeForVault(assetAddress: string, gauges: Gauge[]) {
  return gauges.find((gauge) => {
    // Match Go logic: check SwapToken field first
    if(gauge.swap_token?.toLowerCase() === assetAddress.toLowerCase()) {
      return true
    }
    if(gauge.swap?.toLowerCase() === assetAddress.toLowerCase()) {
      return true
    }
    return false
  })
}

export function findPoolForVault(assetAddress: string, pools: CrvPool[]) {
  return pools.find((pool) => {
    return pool.lpTokenAddress?.toLowerCase() === assetAddress.toLowerCase()
  })
}

export function findFraxPoolForVault(assetAddress: string, fraxPools: FraxPool[]) {
  return fraxPools.find((pool) => {
    return pool.underlyingTokenAddress.toLowerCase() === assetAddress.toLowerCase()
  })
}

export function findSubgraphItemForVault(swapAddress: string, subgraphData: CrvSubgraphPool[]) {
  return subgraphData.find(item =>
    item.address && item.address.toLowerCase() === swapAddress?.toLowerCase()
  )
}

// APY/APR calculation helpers
export function getPoolWeeklyAPY(subgraphItem: CrvSubgraphPool | undefined) {
  const result = new Float(0)
  return result.div(new Float(subgraphItem?.latestWeeklyApy || 0), new Float(100))
}

export function getPoolDailyAPY(subgraphItem: CrvSubgraphPool | undefined) {
  const result = new Float(0)
  return result.div(new Float(subgraphItem?.latestDailyApy || 0), new Float(100))
}

export function getPoolPrice(gauge: Gauge): Float {
  let virtualPrice = new BigNumberInt(0)
  if (gauge.swap_data?.virtual_price) {
    virtualPrice = new BigNumberInt(gauge.swap_data.virtual_price)
  }
  return toNormalizedAmount(virtualPrice, 18)
}

export function getRewardsAPY(chainId: number, pool: CrvPool) {
  let totalRewardAPR = new Float(0)
  if (!pool.gaugeRewards || pool.gaugeRewards.length === 0) {
    return totalRewardAPR
  }

  for (const reward of pool.gaugeRewards) {
    const rewardAPR = new Float().div(new Float(reward.APY), new Float(100))
    totalRewardAPR = new Float().add(totalRewardAPR, rewardAPR)
  }

  return totalRewardAPR
}

export async function getCVXPoolAPY(chainId: number, strategyAddress: `0x${string}`, baseAssetPrice: Float) {
  const client = rpcs.next(chainId)
  let crvAPR = new Float(0)
  let cvxAPR = new Float(0)
  let crvAPY = new Float(0)
  let cvxAPY = new Float(0)

  try {
    // Try to get the PID (Pool ID) - try different function names as they vary by contract
    let rewardPID
    try {
      rewardPID = await client.readContract({
        address: strategyAddress,
        abi: convexBaseStrategyAbi,
        functionName: 'PID',
      })
    } catch (error) {
      console.error('Error fetching CVX pool APY:', getErrorMessage(error), strategyAddress)
      try {
        rewardPID = await client.readContract({
          address: strategyAddress,
          abi: convexBaseStrategyAbi,
          functionName: 'ID',
        })
      } catch (innerError) {
        console.error('Error fetching CVX pool APY:', getErrorMessage(innerError), strategyAddress)
        try {
          rewardPID = await client.readContract({
            address: strategyAddress,
            abi: convexBaseStrategyAbi,
            functionName: 'fraxPid',
          })
        } catch (deepError) {
          console.error('Error fetching CVX pool APY:', getErrorMessage(deepError), strategyAddress)
          return { crvAPR, cvxAPR, crvAPY, cvxAPY }
        }
      }
    }

    // Get pool info from CVX Booster contract
    let poolInfo
    try {
      poolInfo = await client.readContract({
        address: CVX_BOOSTER_ADDRESS[chainId],
        abi: cvxBoosterAbi,
        functionName: 'poolInfo',
        args: [rewardPID],
      }) as CVXPoolInfo
    } catch (error) {
      console.error('Error fetching CVX pool APY:', getErrorMessage(error), strategyAddress)
      return { crvAPR, cvxAPR, crvAPY, cvxAPY }
    }

    // Get reward rate and total supply
    const [rateResult, totalSupply] = await Promise.all([
      client.readContract({
        address: poolInfo.crvRewards,
        abi: crvRewardsAbi,
        functionName: 'rewardRate',
        args: []
      }),
      client.readContract({
        address: poolInfo.crvRewards,
        abi: crvRewardsAbi,
        functionName: 'totalSupply',
        args: []
      })
    ]) as [bigint, bigint]

    // Convert results to normalized amounts
    const rate = toNormalizedAmount(new BigNumberInt(rateResult), 18)
    const supply = toNormalizedAmount(new BigNumberInt(totalSupply), 18)
    let crvPerUnderlying = new Float(0)
    const virtualSupply = new Float(0).mul(supply, baseAssetPrice)

    if (virtualSupply.gt(new Float(0))) {
      crvPerUnderlying = new Float(0).div(rate, virtualSupply)
    }

    const crvPerUnderlyingPerYear = new Float(0).mul(crvPerUnderlying, new Float(31536000)) // seconds in a year
    const cvxPerYear = await getCVXForCRV(chainId, BigInt(crvPerUnderlyingPerYear.toNumber()))

    // Get token prices in parallel
    const [{ priceUsd: crvPrice }, { priceUsd: cvxPrice }] = await Promise.all([
      fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true),
      fetchErc20PriceUsd(chainId, CVX_TOKEN_ADDRESS[chainId], undefined, true)
    ])

    // Calculate APRs
    crvAPR = new Float(0).mul(crvPerUnderlyingPerYear, new Float(crvPrice))
    cvxAPR = new Float(0).mul(cvxPerYear, new Float(cvxPrice))

    const [crvAPRFloat64] = crvAPR.toFloat64()
    const [cvxAPRFloat64] = cvxAPR.toFloat64()

    crvAPY = new Float().setFloat64(convertFloatAPRToAPY(crvAPRFloat64, 365/15))
    cvxAPY = new Float().setFloat64(convertFloatAPRToAPY(cvxAPRFloat64, 365/15))
  } catch (error) {
    console.error('Error calculating CVX pool APY:', error, strategyAddress)
  }

  return {
    crvAPR,
    cvxAPR,
    crvAPY,
    cvxAPY
  }
}

function getStrategyContractAbi(strategy: StrategyWithIndicators) {
  if(strategy.apiVersion === '0.2.2') {
    return YEARN_VAULT_V022_ABI
  }

  if(strategy.apiVersion === '0.3.0' || strategy.apiVersion === '0.3.1') {
    return YEARN_VAULT_V030_ABI
  }

  return YEARN_VAULT_ABI_04
}

export async function determineCurveKeepCRV(strategy: StrategyWithIndicators, chainId: number) {
  let keepPercentage = BigInt(0)
  let keepCRV = BigInt(0)

  try {
    // Run both contract reads in parallel
    const [keepCRVResult, keepPercentageResult] = await Promise.all([
      rpcs.next(chainId).readContract({
        address: strategy.address,
        abi: getStrategyContractAbi(strategy),
        functionName: 'keepCRV',
      }) as Promise<bigint>,
      rpcs.next(chainId).readContract({
        address: strategy.address,
        abi: getStrategyContractAbi(strategy),
        functionName: 'keepCRVPercentage',
      }) as Promise<bigint>
    ])
    keepCRV = keepCRVResult
    keepPercentage = keepPercentageResult
  } catch (error) {
    return 0
  }

  const keepValue = new BigNumberInt(keepCRV).add(new BigNumberInt(keepPercentage))
  return toNormalizedAmount(keepValue, 4).toNumber()
}


export async function calculateCurveForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAPY: Float,
  rewardAPY: Float,
  poolAPY: Float,
  chainId: number,
  lastDebtRatio: Float
}) {
  const chainId = data.chainId
  // Run boost and keepCRV in parallel
  const [yboost, keepCrv] = await Promise.all([
    getCurveBoost(chainId, YEARN_VOTER_ADDRESS[chainId], data.gaugeAddress),
    determineCurveKeepCRV(data.strategy, chainId)
  ])
  const debtRatio = toNormalizedAmount(new BigNumberInt(data.lastDebtRatio.toNumber()), 4)
  const performanceFee = toNormalizedAmount(new BigNumberInt(data.strategy.performanceFee ?? 0), 4)
  const managementFee = toNormalizedAmount(new BigNumberInt(data.strategy.managementFee ?? 0), 4)
  const oneMinusPerfFee = new Float().sub(new Float(1), performanceFee)

  let crvAPY = new Float().mul(data.baseAPY, yboost)
  crvAPY = new Float().add(crvAPY, data.rewardAPY)

  const keepCRVRatio = new Float().add(new Float(1), new Float(Number(keepCrv)))
  let grossAPY = new Float().mul(data.baseAPY, yboost)
  grossAPY = new Float().mul(grossAPY, keepCRVRatio)
  grossAPY = new Float().add(grossAPY, data.rewardAPY)

  let netAPY = new Float().mul(grossAPY, oneMinusPerfFee)

  if (netAPY.gt(managementFee)) {
    netAPY = new Float().sub(netAPY, managementFee)
  } else {
    netAPY = new Float(0)
  }

  return {
    type: 'crv',
    netAPY: netAPY.toFloat64()[0],
    boost: new Float().mul(yboost, debtRatio).toFloat64()[0],
    poolAPY: new Float().mul(data.poolAPY, debtRatio).toFloat64()[0],
    boostedAPR: new Float().mul(crvAPY, debtRatio).toFloat64()[0],
    baseAPR: new Float().mul(data.baseAPY, debtRatio).toFloat64()[0],
    rewardsAPY: new Float().mul(data.rewardAPY, debtRatio).toFloat64()[0],
    keepCRV: new Float(keepCrv).toFloat64()[0]
  }
}

export async function calculateConvexForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAssetPrice: Float,
  poolPrice: Float,
  baseAPY: Float,
  rewardAPY: Float,
  poolWeeklyAPY: Float,
  chainId: number,
  lastDebtRatio: Float
}) {
  const {
    gaugeAddress,
    strategy,
    baseAssetPrice,
    poolPrice,
    baseAPY,
    poolWeeklyAPY,
    chainId,
    lastDebtRatio
  } = data

  // Run boost and keepCRV in parallel
  const [cvxBoost, keepCRV] = await Promise.all([
    getCurveBoost(chainId, gaugeAddress, strategy.address),
    determineConvexKeepCRV(chainId, strategy)
  ])
  const debtRatio = toNormalizedAmount(new BigNumberInt(lastDebtRatio.toNumber()), 4)
  const performanceFee = toNormalizedAmount(new BigNumberInt(strategy.performanceFee ?? 0), 4)
  const managementFee = toNormalizedAmount(new BigNumberInt(strategy.managementFee ?? 0), 4)
  const oneMinusPerfFee = new Float().sub(new Float(1), performanceFee)

  // Run getCVXPoolAPY and getConvexRewardAPY in parallel
  const [{crvAPR, cvxAPR, crvAPY, cvxAPY}, {totalRewardsAPY: rewardsAPY}] = await Promise.all([
    getCVXPoolAPY(chainId, strategy.address, baseAssetPrice),
    getConvexRewardAPY(chainId, strategy.address, baseAssetPrice, poolPrice)
  ])

  const keepCRVRatio = new Float().sub(new Float(1), keepCRV)
  let grossAPY = new Float().mul(crvAPY, keepCRVRatio)
  grossAPY = new Float().add(grossAPY, rewardsAPY)
  grossAPY = new Float().add(grossAPY, poolWeeklyAPY)
  grossAPY = new Float().add(grossAPY, cvxAPY)

  let netAPY = new Float().mul(grossAPY, oneMinusPerfFee)
  if(netAPY.gt(managementFee)) {
    netAPY = new Float().sub(netAPY, managementFee)
  } else {
    netAPY = new Float(0)
  }

  return {
    type: 'cvx',
    debtRatio: debtRatio.toFloat64()[0],
    netAPY: netAPY.toFloat64()[0],
    boost: new Float().mul(cvxBoost, debtRatio).toFloat64()[0],
    poolAPY: new Float().mul(poolWeeklyAPY, debtRatio).toFloat64()[0],
    boostedAPR: new Float().mul(crvAPR, debtRatio).toFloat64()[0],
    baseAPR: new Float().mul(baseAPY, debtRatio).toFloat64()[0],
    cvxAPR: new Float().mul(cvxAPR, debtRatio).toFloat64()[0],
    rewardsAPY: new Float().mul(data.rewardAPY, debtRatio).toFloat64()[0],
    keepCRV: keepCRV.toFloat64()[0]
  }
}

export async function calculateFraxForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
    baseAssetPrice: Float,
  poolPrice: Float,
  baseAPY: Float,
  rewardAPY: Float,
  poolWeeklyAPY: Float,
  chainId: number,
  lastDebtRatio: Float
}, fraxPool: FraxPool | undefined) {
  if(!fraxPool) {
    return null
  }
  const baseConvexStrategyData = await calculateConvexForwardAPY(data)
  const minRewardsAPR = parseFloat(fraxPool.totalRewardAprs.min)

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

export async function calculatePrismaForwardAPR(data: {
  vault: Thing,
  chainId: number,
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAssetPrice: Float,
  poolPrice: Float,
  baseAPY: Float,
  rewardAPY: Float,
  poolWeeklyAPY: Float,
}) {
  const {
    vault,
    chainId
  } = data

  const [receiver] = await rpcs.next(chainId).readContract({
    address: vault.address,
    abi: yprismaAbi,
    functionName: 'prismaReceiver',
  })

  if (receiver === zeroAddress) {
    return null
  }

  // Run baseConvexStrategyData and getPrismaAPY in parallel
  const [baseConvexStrategyData, [, prismaAPY]] = await Promise.all([
    calculateConvexForwardAPY({
      gaugeAddress: data.gaugeAddress,
      strategy: data.strategy,
      baseAssetPrice: data.baseAssetPrice,
      poolPrice: data.poolPrice,
      baseAPY: data.baseAPY,
      rewardAPY: data.rewardAPY,
      poolWeeklyAPY: data.poolWeeklyAPY,
      chainId: data.chainId,
      lastDebtRatio: new Float(data.strategy.debtRatio || 0)
    }),
    getPrismaAPY(chainId, receiver)
  ])

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

export async function calculateGaugeBaseAPR(
  gauge: Gauge,
  crvTokenPrice: Float,
  poolPrice: Float,
  baseAssetPrice: Float
) {
  // Initialize inflation rate
  let inflationRate = new Float(0)
  if (typeof gauge.gauge_controller.inflation_rate === 'string') {
    inflationRate = toNormalizedAmount(new BigNumberInt(gauge.gauge_controller.inflation_rate), 18)
  } else {
    inflationRate = new Float().setFloat64(gauge.gauge_controller.inflation_rate)
  }

  // Convert parameters to Float objects
  const gaugeWeight = toNormalizedAmount(
    new BigNumberInt(gauge.gauge_controller.gauge_relative_weight),
    18
  )
  const secondsPerYear = new Float(31556952)
  const workingSupply = toNormalizedAmount(
    new BigNumberInt(gauge.gauge_data.working_supply),
    18
  )
  const perMaxBoost = new Float(0.4)
  const crvPrice = (crvTokenPrice instanceof Float) ? crvTokenPrice : new Float(crvTokenPrice)
  const poolPriceFloat = (poolPrice instanceof Float) ? poolPrice : new Float(poolPrice)
  const baseAssetPriceFloat = (baseAssetPrice instanceof Float) ? baseAssetPrice : new Float(baseAssetPrice)

  // Calculate baseAPR using the formula from Go implementation:
  // baseAPR = (inflationRate * gaugeWeight * (secondsPerYear / workingSupply) * (perMaxBoost / poolPrice) * crvPrice) / baseAssetPrice

  // Step 1: inflationRate * gaugeWeight
  let baseAPR = new Float(0).mul(inflationRate, gaugeWeight)

  // Step 2: * (secondsPerYear / workingSupply)
  const yearsBySupply = new Float(0).div(secondsPerYear, workingSupply)
  baseAPR = new Float().mul(baseAPR, yearsBySupply)

  // Step 3: * (perMaxBoost / poolPrice)
  const boostByPool = new Float(0).div(perMaxBoost, poolPriceFloat)
  baseAPR = new Float().mul(baseAPR, boostByPool)

  // Step 4: * crvPrice
  baseAPR = new Float().mul(baseAPR, crvPrice)

  // Step 5: / baseAssetPrice
  baseAPR = new Float().div(baseAPR, baseAssetPriceFloat)

  // Convert APR to APY using 365/15 periods per year (as in Go implementation)

  const [baseAPRFloat] = baseAPR.toFloat64()

  const baseAPY = new Float().setFloat64(convertFloatAPRToAPY(baseAPRFloat, 365/15))

  return {
    baseAPY: baseAPY,
    baseAPR: baseAPR
  }
}

export async function calculateCurveLikeStrategyAPR(
  vault: Thing & { name: string },
  strategy: StrategyWithIndicators,
  gauge: Gauge,
  pool: CrvPool | undefined,
  fraxPool: FraxPool | undefined,
  subgraphItem: CrvSubgraphPool | undefined,
  chainId: number
): Promise<{
    type: string;
    netAPY: number;
    boost: number;
    poolAPY: number;
    boostedAPR: number;
    baseAPR: number;
    rewardsAPY: number;
    cvxAPR?: number;
    keepCRV?: number;
  } | null > {

  const baseAssetPrice = new Float().setFloat64(gauge.lpTokenPrice || 0)

  const [{ priceUsd }, poolPrice] = await Promise.all([
    fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true),
    Promise.resolve(getPoolPrice(gauge))
  ])
  const crvPrice = new Float(priceUsd)

  const { baseAPY } = await calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)

  const rewardAPY = getRewardsAPY(chainId, pool as CrvPool)
  const poolWeeklyAPY = getPoolWeeklyAPY(subgraphItem)
  const poolWeeklyAPYFloat = poolWeeklyAPY

  if (isPrismaStrategy(strategy)) {
    return calculatePrismaForwardAPR({
      vault,
      chainId,
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice: baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolWeeklyAPY: poolWeeklyAPY,
    })
  }

  if (isFraxStrategy(strategy)) {
    return calculateFraxForwardAPY({
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolWeeklyAPY: poolWeeklyAPY,
      chainId,
      lastDebtRatio: new Float(strategy.debtRatio || 0)
    }, fraxPool)
  }

  if (isConvexStrategy(strategy)) {
    return calculateConvexForwardAPY({
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolWeeklyAPY: poolWeeklyAPYFloat,
      chainId,
      lastDebtRatio: new Float(strategy.debtRatio || 0)
    })
  }

  return calculateCurveForwardAPY({
    gaugeAddress: gauge.gauge as `0x${string}`,
    strategy,
    baseAPY,
    rewardAPY,
    poolAPY: poolWeeklyAPY,
    chainId,
    lastDebtRatio: new Float(strategy.debtRatio || 0)
  })
}

export async function computeCurveLikeForwardAPY({
  vault,
  gauges,
  pools,
  subgraphData,
  fraxPools,
  allStrategiesForVault,
  chainId
}:{
  vault: Thing & { name: string },
  gauges: Gauge[],
  pools: CrvPool[],
  subgraphData: CrvSubgraphPool[],
  fraxPools: FraxPool[],
  allStrategiesForVault: StrategyWithIndicators[],
  chainId: number
}) {
  const gauge = findGaugeForVault(vault.defaults.asset, gauges)
  if (!gauge) {
    return { type: '', netAPY: 0, composite: {} }
  }

  const pool = findPoolForVault(vault.defaults.asset, pools)
  const fraxPool = findFraxPoolForVault(vault.defaults.asset, fraxPools)
  const subgraphItem = findSubgraphItemForVault(gauge.swap, subgraphData)

  let typeOf = ''
  let netAPY = new Float(0)
  let boost = new Float(0)
  let poolAPY = new Float(0)
  let boostedAPR = new Float(0)
  let baseAPR = new Float(0)
  let cvxAPR = new Float(0)
  let rewardsAPY = new Float(0)
  let keepCRV = new Float(0)

  // Run all strategy APR calculations in parallel and aggregate after
  const strategyAPRs = await Promise.all(
    allStrategiesForVault
      .map(async (strategy) => {
        if (!strategy.debtRatio || strategy.debtRatio === 0) {
          return null
        }

        const strategyAPR = await calculateCurveLikeStrategyAPR(
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

  for (const strategyAPR of strategyAPRs) {
    if (!strategyAPR) continue
    typeOf += strategyAPR?.type
    netAPY = new Float(0).add(netAPY, new Float(strategyAPR?.netAPY || 0))
    boost = new Float(0).add(boost, new Float(strategyAPR?.boost || 0))
    poolAPY = new Float(0).add(poolAPY, new Float(strategyAPR?.poolAPY || 0))
    boostedAPR = new Float(0).add(boostedAPR, new Float(strategyAPR?.boostedAPR || 0))
    baseAPR = new Float(0).add(baseAPR, new Float(strategyAPR?.baseAPR || 0))
    cvxAPR = new Float(0).add(cvxAPR, new Float(strategyAPR?.cvxAPR || 0))
    rewardsAPY = new Float(0).add(rewardsAPY, new Float(strategyAPR?.rewardsAPY || 0))
    keepCRV = new Float(0).add(keepCRV, new Float(strategyAPR?.keepCRV || 0))
  }

  return {
    type: typeOf,
    netAPR: netAPY.toFloat64()[0],
    boost: boost.toFloat64()[0],
    poolAPY: poolAPY.toFloat64()[0],
    boostedAPR: boostedAPR.toFloat64()[0],
    baseAPR: baseAPR.toFloat64()[0],
    cvxAPR: cvxAPR.toFloat64()[0],
    rewardsAPY: rewardsAPY.toFloat64()[0],
    keepCRV: keepCRV.toFloat64()[0],
  }
}
