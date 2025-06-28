import { StrategyWithIndicators, Thing } from 'lib/types'
import { zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../../../../prices'
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
import { BigNumberInt, toNormalizedAmount, toNormalizedAmount as toNormalizedIntAmount } from './helpers/bignumber-int'
import { BigNumber } from '@ethersproject/bignumber'
import { CVXPoolInfo } from './types/cvx'
// Strategy type detection functions
export function isCurveStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
  return (
    (vaultName?.includes('curve') || vaultName?.includes('convex') || vaultName?.includes('crv')) &&
    !vaultName?.includes('ajna-')
  )
}

export function isConvexStrategy(strategy: StrategyWithIndicators) {
  return strategy.name.toLowerCase().includes('convex')
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
    if(gauge.swap) {
      return gauge.swap?.toLowerCase() === assetAddress.toLowerCase()
    }
    if(gauge.swap_token?.toLowerCase() === assetAddress.toLowerCase()) {
      return gauge
    }
  })
}

export function findPoolForVault(assetAddress: string, pools: CrvPool[]) {
  return pools.find((pool) => {
    if(pool.lpTokenAddress === assetAddress) {
      return pool
    }
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
  return Number(subgraphItem?.latestWeeklyApy || 0)
}

export function getPoolDailyAPY(subgraphItem: CrvSubgraphPool | undefined) {
  return Number(subgraphItem?.latestDailyApy || 0)
}

export function getPoolPrice(gauge: Gauge): number {
  let virtualPrice = 0
  if (gauge.swap_data?.virtual_price) {
    virtualPrice = Number(gauge.swap_data.virtual_price)
  }
  const divisor = 10 ** 18
  return virtualPrice / divisor
}

export function getRewardsAPY(chainId: number, pool: CrvPool) {
  let totalRewardAPR = 0
  if (!pool.gaugeRewards || pool.gaugeRewards.length === 0) {
    return totalRewardAPR
  }

  for (const reward of pool.gaugeRewards) {
    const rewardAPR = Number(reward.APY || 0)
    totalRewardAPR = totalRewardAPR + rewardAPR
  }

  return totalRewardAPR
}

export async function getCVXPoolAPY(chainId: number, strategyAddress: `0x${string}`, baseAssetPrice: number) {
  const client = rpcs.next(chainId)
  const crvAPR = new Float(0)
  const cvxAPR = new Float(0)
  const crvAPY = new Float(0)
  const cvxAPY = new Float(0)

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
      console.error('Error getting reward PID:', error, strategyAddress)
      try {
        rewardPID = await client.readContract({
          address: strategyAddress,
          abi: convexBaseStrategyAbi,
          functionName: 'ID',
        })
      } catch (innerError) {
        console.error('Error getting reward ID:', innerError, strategyAddress)
        try {
          rewardPID = await client.readContract({
            address: strategyAddress,
            abi: convexBaseStrategyAbi,
            functionName: 'fraxPid',
          })
        } catch (deepError) {
          console.error('Error getting reward fraxPid:', deepError, strategyAddress)
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
      console.error('Error getting pool info:', error, strategyAddress)
      return { crvAPR, cvxAPR, crvAPY, cvxAPY }
    }

    // Get reward rate and total supply
    const [rateResult, totalSupply] = await Promise.all([
      client.readContract({
        address: poolInfo.crvRewards,
        abi: crvRewardsAbi,
        functionName: 'rewardRate',
      }),
      client.readContract({
        address: poolInfo.crvRewards,
        abi: crvRewardsAbi,
        functionName: 'totalSupply',
      })
    ]) as [bigint, bigint]

    // Convert results to normalized amounts
    const rate = toNormalizedIntAmount(new BigNumberInt(rateResult.toString()), 18)
    const supply = toNormalizedIntAmount(new BigNumberInt(totalSupply.toString()), 18)
    const crvPerUnderlying = new Float(0)
    const virtualSupply = new Float().mul(supply, new Float(baseAssetPrice))

    if (virtualSupply.gt(new Float(0))) {
      crvPerUnderlying.div(rate, virtualSupply)
    }

    const crvPerUnderlyingPerYear = new Float().mul(crvPerUnderlying, new Float(31536000)) // seconds in a year
    const cvxPerYear = await getCVXForCRV(chainId, BigInt(crvPerUnderlyingPerYear.toNumber()))

    // Get token prices
    const { priceUsd: crvPrice } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
    const { priceUsd: cvxPrice } = await fetchErc20PriceUsd(chainId, CVX_TOKEN_ADDRESS[chainId], undefined, true)

    // Calculate APRs
    crvAPR.mul(crvPerUnderlyingPerYear, new Float(crvPrice))
    cvxAPR.mul(new Float(Number(cvxPerYear)), new Float(cvxPrice))

    // Convert APRs to APYs
    crvAPY.set(BigNumber.from(convertFloatAPRToAPY(crvAPR.toNumber(), 365/15)))
    cvxAPY.set(BigNumber.from(convertFloatAPRToAPY(cvxAPR.toNumber(), 365/15)))
  } catch (error) {
    console.error('Error calculating CVX pool APY:', error)
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
    keepCRV = await rpcs.next(chainId).readContract({
      address: strategy.address,
      abi: getStrategyContractAbi(strategy),
      functionName: 'keepCRV',
    }) as bigint

    keepPercentage = await rpcs.next(chainId).readContract({
      address: strategy.address,
      abi: getStrategyContractAbi(strategy),
      functionName: 'keepCRVPercentage',
    }) as bigint

  } catch (error) {
    console.error('Error determining curve keep CRV:', error, strategy.address)
    return 0
  }

  const keepValue = new BigNumberInt(keepCRV).add(new BigNumberInt(keepPercentage))
  return toNormalizedAmount(keepValue, 4).toNumber()

}


export async function calculateCurveForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAPY: number,
  rewardAPY: number,
  poolAPY: number,
  chainId: number,
  lastDebtRatio: number
}) {
  const chainId = data.chainId
  const yboost = await getCurveBoost(chainId, YEARN_VOTER_ADDRESS[chainId], data.gaugeAddress)

  const keepCrv = await determineCurveKeepCRV(data.strategy, chainId)
  const debtRatio = toNormalizedIntAmount(new BigNumberInt(data.lastDebtRatio), 4)
  const performanceFee = toNormalizedIntAmount(new BigNumberInt(data.strategy.performanceFee ?? 0), 4)
  const managementFee = toNormalizedIntAmount(new BigNumberInt(data.strategy.managementFee ?? 0), 4)
  const oneMinusPerfFee = new Float().sub(new Float(1), performanceFee)

  let crvAPY = new Float().mul(new Float(data.baseAPY), new Float(yboost))
  crvAPY = new Float().add(crvAPY, new Float(data.rewardAPY))

  const keepCRVRatio = new Float().add(new Float(1), new Float(Number(keepCrv)))
  let grossAPY = new Float().mul(new Float(data.baseAPY), new Float(yboost))
  grossAPY = new Float().mul(grossAPY, keepCRVRatio)
  grossAPY = new Float().add(grossAPY, new Float(data.rewardAPY))

  let netAPY = new Float().mul(grossAPY, oneMinusPerfFee)

  if (netAPY.gt(managementFee)) {
    netAPY = new Float().sub(netAPY, managementFee)
  } else {
    netAPY = new Float(0)
  }

  return {
    type: 'curve',
    debtRatio: debtRatio.toFloat64()[0],
    netAPY: netAPY.toFloat64()[0],
    boost: new Float().mul(new Float(yboost), debtRatio).toFloat64()[0],
    poolAPY: new Float().mul(new Float(data.poolAPY), debtRatio).toFloat64()[0],
    boostedAPR: new Float().mul(crvAPY, debtRatio).toFloat64()[0],
    baseAPR: new Float().mul(new Float(data.baseAPY), debtRatio).toFloat64()[0],
    rewardsAPY: new Float().mul(new Float(data.rewardAPY), debtRatio).toFloat64()[0],
    keepCRV: new Float(keepCrv).toFloat64()[0]
  }
}

export async function calculateConvexForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAssetPrice: number,
  poolPrice: number,
  baseAPY: number,
  rewardAPY: number,
  poolDailyAPY: number,
  chainId: number,
  lastDebtRatio: number
}) {
  const {
    gaugeAddress,
    strategy,
    baseAssetPrice,
    poolPrice,
    baseAPY,
    poolDailyAPY,
    chainId,
    lastDebtRatio
  } = data
  const cvxBoost = await getCurveBoost(chainId, gaugeAddress, strategy.address)
  const keepCRV = await determineConvexKeepCRV(chainId, strategy)
  const debtRatio = toNormalizedIntAmount(new BigNumberInt(lastDebtRatio), 4)
  const performanceFee = toNormalizedIntAmount(new BigNumberInt(strategy.performanceFee ?? 0), 4)
  const managementFee = toNormalizedIntAmount(new BigNumberInt(strategy.managementFee ?? 0), 4)
  const oneMinusPerfFee = new Float().sub(new Float(1), performanceFee)
  const {crvAPR, cvxAPR, crvAPY, cvxAPY} = await getCVXPoolAPY(chainId, strategy.address, baseAssetPrice)

  const {totalRewardsAPY} = await getConvexRewardAPY(chainId, strategy.address, baseAssetPrice, poolPrice)

  const [keepCRVRatio] = new Float().sub(new Float(1), keepCRV).toFloat64()
  let grossAPY = new Float().mul(crvAPY, new Float(keepCRVRatio))
  grossAPY = new Float().add(grossAPY, new Float(keepCRVRatio))
  grossAPY = new Float().add(grossAPY, new Float(poolDailyAPY))
  grossAPY = new Float().add(grossAPY, cvxAPY)


  let netAPY = new Float().mul(grossAPY, oneMinusPerfFee)
  if(netAPY.gt(managementFee)) {
    netAPY = new Float().sub(netAPY, managementFee)
  } else {
    netAPY = new Float(0)
  }


  return {
    type: 'convex',
    debtRatio: debtRatio.toFloat64()[0],
    netAPY: netAPY.toFloat64()[0],
    boost: new Float().mul(new Float(cvxBoost), debtRatio).toFloat64()[0],
    poolAPY: new Float(poolDailyAPY).mul(new Float(), debtRatio).toFloat64()[0],
    boostedAPR: crvAPR.mul(new Float(), debtRatio).toFloat64()[0],
    baseAPR: new Float(baseAPY).mul(new Float(), debtRatio).toFloat64()[0],
    cvxAPR: cvxAPR.mul(new Float(), debtRatio).toFloat64()[0],
    rewardsAPY: new Float().mul(new Float(totalRewardsAPY), debtRatio).toFloat64()[0],
    keepCRV: keepCRV.toFloat64()[0]
  }
}

export async function calculateFraxForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAssetPrice: number,
  poolPrice: number,
  baseAPY: number,
  rewardAPY: number,
  poolDailyAPY: number,
  chainId: number,
  lastDebtRatio: number
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
  baseAssetPrice: number,
  poolPrice: number,
  baseAPY: number | Float,
  rewardAPY: number,
  poolDailyAPY: number,
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

  // Convert number to Float if necessary
  const baseAPYFloat = data.baseAPY instanceof Float ? data.baseAPY : new Float(data.baseAPY)

  const baseConvexStrategyData = await calculateConvexForwardAPY({
    gaugeAddress: data.gaugeAddress,
    strategy: data.strategy,
    baseAssetPrice: data.baseAssetPrice,
    poolPrice: data.poolPrice,
    baseAPY: baseAPYFloat.toNumber(),
    rewardAPY: data.rewardAPY,
    poolDailyAPY: data.poolDailyAPY,
    chainId: data.chainId,
    lastDebtRatio: data.strategy.debtRatio || 0
  })

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

export async function calculateGaugeBaseAPR(
  gauge: Gauge,
  crvTokenPrice: number | Float,
  poolPrice: bigint | number | Float,
  baseAssetPrice: number | Float
) {
  // Initialize inflation rate
  let inflationRate = new Float(0)
  if (typeof gauge.gauge_controller.inflation_rate === 'string') {
    inflationRate = toNormalizedIntAmount(new BigNumberInt(gauge.gauge_controller.inflation_rate), 18)
  } else {
    inflationRate.setFloat64(gauge.gauge_controller.inflation_rate as number)
  }

  // Convert parameters to Float objects
  const gaugeWeight = toNormalizedIntAmount(
    new BigNumberInt(gauge.gauge_controller.gauge_relative_weight),
    18
  )
  const secondsPerYear = new Float(31556952)
  const workingSupply = toNormalizedIntAmount(
    new BigNumberInt(gauge.gauge_data.working_supply),
    18
  )
  const perMaxBoost = new Float(0.4)
  const crvPrice = (crvTokenPrice instanceof Float) ? crvTokenPrice : new Float(crvTokenPrice)
  const poolPriceFloat = (poolPrice instanceof Float) ? poolPrice : new Float(poolPrice.toString())
  const baseAssetPriceFloat = (baseAssetPrice instanceof Float) ? baseAssetPrice : new Float(baseAssetPrice)

  // Calculate baseAPR using the formula from Go implementation:
  // baseAPR = (inflationRate * gaugeWeight * (secondsPerYear / workingSupply) * (perMaxBoost / poolPrice) * crvPrice) / baseAssetPrice

  // Step 1: inflationRate * gaugeWeight
  const baseAPR = new Float(0).mul(inflationRate, gaugeWeight)

  // Step 2: * (secondsPerYear / workingSupply)
  const yearsBySupply = new Float(0).div(secondsPerYear, workingSupply)
  baseAPR.mul(baseAPR, yearsBySupply)

  // Step 3: * (perMaxBoost / poolPrice)
  const boostByPool = new Float(0).div(perMaxBoost, poolPriceFloat)
  baseAPR.mul(baseAPR, boostByPool)

  // Step 4: * crvPrice
  baseAPR.mul(baseAPR, crvPrice)

  // Step 5: / baseAssetPrice
  baseAPR.div(baseAPR, baseAssetPriceFloat)

  // Convert APR to APY using 365/15 periods per year (as in Go implementation)

  const baseAPRFloat2 = baseAPR.toFloat64()
  const [baseAPRFloat] = baseAPRFloat2

  const baseAPY = new Float().setFloat64(convertFloatAPRToAPY(baseAPRFloat, 365/15))

  return {
    baseAPY: baseAPY.toFloat64()[0],
    baseAPR: baseAPRFloat
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
  /**********************************************************************************************
  ** First thing is to retrieve the data we need from curve API. This includes the pool, the
  ** gauges and some APY data from their subgraph.
  **********************************************************************************************/
  // if (!subgraphItem?.latestWeeklyApy) {
  //   console.warn(`No APY data for vault ${vault.address}`)
  // }

  /**********************************************************************************************
  ** We will need a bunch of prices to calculate the APY.
  ** - We get the base asset price from the gauge LpTokenPrice field, which is in base 2.
  ** - We get the CRV price from our price package, which is in base 6 but converted in 2.
  ** - We get the pool price from the curve API, which is in base 18 but converted in 2.
  **********************************************************************************************/
  const baseAssetPrice = Number(gauge.lpTokenPrice || 0)

  const { priceUsd } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
  const crvPrice = priceUsd

  const poolPrice = getPoolPrice(gauge)

  const { baseAPY } = await calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)


  const rewardAPY = getRewardsAPY(chainId, pool as CrvPool)

  const poolWeeklyAPY = getPoolWeeklyAPY(subgraphItem)
  const poolDailyAPY = getPoolDailyAPY(subgraphItem)


  const poolWeeklyAPYFloat = poolWeeklyAPY
  const poolDailyAPYFloat = poolDailyAPY
  const rewardAPYFloat = rewardAPY



  if (isPrismaStrategy(strategy)) {
    return calculatePrismaForwardAPR({
      vault,
      chainId,
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice: Number(baseAssetPrice),
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY: poolDailyAPYFloat,
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
      poolDailyAPY: poolDailyAPYFloat,
      chainId,
      lastDebtRatio: strategy.debtRatio || 0
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
      poolDailyAPY: poolDailyAPYFloat,
      chainId,
      lastDebtRatio: strategy.debtRatio || 0
    })
  }

  return calculateCurveForwardAPY({
    gaugeAddress: gauge.gauge as `0x${string}`,
    strategy,
    baseAPY,
    rewardAPY: rewardAPYFloat,
    poolAPY: poolWeeklyAPYFloat,
    chainId,
    lastDebtRatio: strategy.debtRatio || 0
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


  await Promise.all(
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

        typeOf += strategyAPR?.type
        netAPY = new Float(0).add(netAPY, new Float(strategyAPR?.netAPY || 0))
        boost = new Float(0).add(boost, new Float(strategyAPR?.boost || 0))
        poolAPY = new Float(0).add(poolAPY, new Float(strategyAPR?.poolAPY || 0))
        boostedAPR = new Float(0).add(boostedAPR, new Float(strategyAPR?.boostedAPR || 0))
        baseAPR = new Float(0).add(baseAPR, new Float(strategyAPR?.baseAPR || 0))
        cvxAPR = new Float(0).add(cvxAPR, new Float(strategyAPR?.cvxAPR || 0))
        rewardsAPY = new Float(0).add(rewardsAPY, new Float(strategyAPR?.rewardsAPY || 0))
        keepCRV = new Float(0).add(keepCRV, new Float(strategyAPR?.keepCRV || 0))

        return strategyAPR
      })
  )


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
