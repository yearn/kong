import { Thing } from 'lib/types'
import { createPublicClient, http, zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../prices'
import {
  convexBaseStrategyAbi,
  crvRewardsAbi,
  cvxBoosterAbi,
  yprismaAbi, yStrategyAbi
} from './abis'
import {
  convertFloatAPRToAPY,
  CRV_TOKEN_ADDRESS, CVX_TOKEN_ADDRESS,
  getConvexRewardAPY,
  getCurveBoost,
  getCVXForCRV,
  getPrismaAPY,
  YEARN_VOTER_ADDRESS
} from './helpers/index'
import { Gauge } from './types/gauges'
import { CrvPool } from './types/crv-pools'
import { CrvSubgraphPool } from './types/crv-subgraph'
import { FraxPool } from './types/frax-pools'
import { rpcs } from 'lib/rpcs'
import { StrategyWithIndicatorAndManagementFee } from '.'

// Strategy type detection functions
export function isCurveStrategy(strategy) {
  const strategyName = strategy.name.toLowerCase()
  return (
    (strategyName.includes('curve') || strategyName.includes('convex')) &&
    !strategyName.includes('ajna-')
  )
}

export function isConvexStrategy(strategy) {
  const strategyName = strategy.name.toLowerCase()
  return strategyName.includes('convex')
}

export function isFraxStrategy(strategy) {
  const strategyName = strategy.name.toLowerCase()
  return strategyName.includes('frax')
}

export function isPrismaStrategy(strategy) {
  const strategyName = strategy.name.toLowerCase()
  return strategyName.includes('prisma')
}

// Find functions
export function findGaugeForVault(assetAddress, gauges) {
  return gauges.find((gauge) => {
    if(gauge.swapToken === assetAddress) {
      return gauge
    }
  })
}

export function findPoolForVault(assetAddress, pools) {
  return pools.find((pool) => {
    if(pool.LPTokenAddress === assetAddress) {
      return pool
    }
  })
}

export function findFraxPoolForVault(assetAddress, fraxPools) {
  return fraxPools.find((pool) => {
    if(pool.underlyingTokenAddress === assetAddress) {
      return pool
    }
  })
}

export function findSubgraphItemForVault(swapAddress, subgraphData) {
  return subgraphData.find(item =>
    item.address && item.address.toLowerCase() === swapAddress.toLowerCase()
  ) || { latestWeeklyApy: 0, latestDailyApy: 0 }
}

// APY/APR calculation helpers
export function getPoolWeeklyAPY(subgraphItem) {
  return BigInt(subgraphItem.latestWeeklyApy || 0) / 100n
}

export function getPoolDailyAPY(subgraphItem) {
  return BigInt(subgraphItem.latestDailyApy || 0) / 100n
}

export function getPoolPrice(gauge) {
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

export function getRewardsAPY(chainId, pool) {
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

export async function getCVXPoolAPY(chainId, strategyAddress, baseAssetPrice) {
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

export async function determineCurveKeepCRV(strategy, chainId) {
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

export async function calculateCurveForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicatorAndManagementFee,
  baseAPY: bigint,
  rewardAPY: bigint,
  poolAPY: bigint,
  chainId: number,
  lastDebtRatio: bigint
}) {
  const chainId = data.chainId
  const yboost = await getCurveBoost(chainId, YEARN_VOTER_ADDRESS[chainId], data.gaugeAddress)

  const keepCrv = await determineCurveKeepCRV(data.strategy, chainId)
  const debtRatio = data.lastDebtRatio
  const performanceFee = data.strategy.performanceFee
  const managementFee = data.strategy.managementFee
  const oneMinusPerfFee = BigInt(1) - (performanceFee || BigInt(0))

  let crvAPY = data.baseAPY * BigInt(yboost)
  crvAPY = crvAPY + data.rewardAPY

  const keepCRVRatio = 1 + Number(keepCrv)
  let grossAPY = data.baseAPY * BigInt(yboost)
  grossAPY = grossAPY * BigInt(keepCRVRatio)
  grossAPY = grossAPY + data.rewardAPY
  grossAPY = grossAPY + data.poolAPY

  let netAPY = grossAPY + oneMinusPerfFee

  if(netAPY > (managementFee || BigInt(0))) {
    netAPY = netAPY - (managementFee || BigInt(0))
  }else {
    netAPY = 0n
  }

  return {
    type: 'curve',
    debtRatio,
    netAPY,
    boost: BigInt(yboost) * debtRatio,
    poolAPY: data.poolAPY * debtRatio,
    boostedAPR: crvAPY * debtRatio,
    baseAPR: data.baseAPY * debtRatio,
    rewardsAPY: data.rewardAPY * debtRatio,
    keepCRV: keepCrv
  }
}

export async function calculateConvexForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicatorAndManagementFee,
  baseAssetPrice: bigint,
  poolPrice: bigint,
  baseAPY: number,
  rewardAPY: bigint,
  poolDailyAPY: bigint,
  chainId: number,
  lastDebtRatio: bigint
}) {
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

  const keepCRV = await determineCurveKeepCRV(strategy, chainId)

  const debtRatio = lastDebtRatio
  const performanceFee = strategy.performanceFee
  const managementFee = strategy.managementFee
  const oneMinusPerfFee = BigInt(1) - (performanceFee || BigInt(0))

  const {crvAPR, cvxAPR, crvAPY, cvxAPY } = await getCVXPoolAPY(chainId, strategy.address, baseAssetPrice)

  const {totalRewardsAPY} = await getConvexRewardAPY(chainId, strategy.address, baseAssetPrice, poolPrice)
  const keepCRVRatio = 1 - Number(keepCRV)
  let grossApy = crvAPY * keepCRVRatio
  grossApy = grossApy + Number(rewardAPY) + Number(poolDailyAPY) + cvxAPY

  let netApy = BigInt(grossApy) * oneMinusPerfFee
  if (netApy > (managementFee || BigInt(0))) {
    netApy = netApy - (managementFee || BigInt(0))
  }else {
    netApy = 0n
  }
  const payload = {
    type: 'convex',
    debtRatio,
    netAPY: netApy * debtRatio,
    boost: BigInt(cvxBoost) * debtRatio,
    boostedAPR: BigInt(crvAPR) * debtRatio,
    baseAPR: BigInt(baseAPY) * debtRatio,
    cvxAPR: BigInt(cvxAPR) * debtRatio,
    rewardsAPY: BigInt(totalRewardsAPY) * debtRatio,
    keepCRV,
    rewardAPY: BigInt(rewardAPY) * debtRatio,
    poolAPY: BigInt(poolDailyAPY) * debtRatio,
  }

  return payload
}

export async function calculateFraxForwardAPY(data, fraxPool) {
  const baseConvexStrategyData = await calculateConvexForwardAPY(data)
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

export async function calculatePrismaForwardAPR(data: {
  vault: Thing,
  chainId: number,
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicatorAndManagementFee,
  baseAssetPrice: bigint,
  poolPrice: bigint,
  baseAPY: number,
  rewardAPY: bigint,
  poolDailyAPY: bigint,
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

  const baseConvexStrategyData = await calculateConvexForwardAPY({
    gaugeAddress: data.gaugeAddress,
    strategy: data.strategy,
    baseAssetPrice: data.baseAssetPrice,
    poolPrice: data.poolPrice,
    baseAPY: data.baseAPY,
    rewardAPY: data.rewardAPY,
    poolDailyAPY: data.poolDailyAPY,
    chainId: data.chainId,
    lastDebtRatio: data.strategy.debtRatio || BigInt(0)
  })

  const [, prismaAPY] = await getPrismaAPY(chainId, receiver)

  return {
    type: 'prisma',
    debtRatio: baseConvexStrategyData.debtRatio,
    netAPY: baseConvexStrategyData.netAPY + BigInt(prismaAPY),
    boost: baseConvexStrategyData.boost,
    poolAPY: baseConvexStrategyData.poolAPY,
    boostedAPR: baseConvexStrategyData.boostedAPR,
    baseAPR: baseConvexStrategyData.baseAPR,
    cvxAPR: baseConvexStrategyData.cvxAPR,
    rewardsAPY: baseConvexStrategyData.rewardsAPY + BigInt(prismaAPY),
  }
}

export async function calculateGaugeBaseAPR(gauge, crvTokenPrice, poolPrice, baseAssetPrice) {
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

export async function calculateCurveLikeStrategyAPR(
  vault: Thing,
  strategy: StrategyWithIndicatorAndManagementFee,
  gauge: Gauge,
  pool: CrvPool,
  fraxPool: FraxPool,
  subgraphItem: CrvSubgraphPool,
  chainId: number
): Promise<{
    type: string;
    netAPY: bigint;
    boost: bigint;
    poolAPY: bigint;
    boostedAPR: bigint;
    baseAPR: bigint;
    rewardsAPY: bigint;
    cvxAPR?: bigint;
    keepCRV?: bigint;
  } | null > {
  const baseAssetPrice = BigInt(gauge.lpTokenPrice || 0)

  const { priceUsd } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
  const crvPrice = BigInt(priceUsd)

  const poolPrice = getPoolPrice(gauge)

  const { baseAPY } = await calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)

  const rewardAPY = getRewardsAPY(chainId, pool)

  const poolWeeklyAPY = getPoolWeeklyAPY(subgraphItem)
  const poolDailyAPY = getPoolDailyAPY(subgraphItem)

  if (isPrismaStrategy(strategy)) {
    return calculatePrismaForwardAPR({
      vault,
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
      chainId
    })
  }

  if (isFraxStrategy(strategy)) {
    return calculateFraxForwardAPY({
      vault,
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
      chainId,
      lastDebtRatio: strategy.debtRatio
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
      poolDailyAPY,
      chainId,
      lastDebtRatio: strategy.debtRatio || BigInt(0)
    })
  }

  return calculateCurveForwardAPY({
    gaugeAddress: gauge.gauge as `0x${string}`,
    strategy,
    baseAPY: BigInt(baseAPY),
    rewardAPY,
    poolAPY: poolWeeklyAPY,
    chainId,
    lastDebtRatio: strategy.debtRatio || BigInt(0)
  })
}

export async function computeCurveLikeForwardAPY(
  vault: Thing,
  gauges: Gauge[],
  pools: CrvPool[],
  subgraphData: CrvSubgraphPool[],
  fraxPools: FraxPool[],
  allStrategiesForVault: StrategyWithIndicatorAndManagementFee[],
  chainId: number
) {
  const gauge = findGaugeForVault(vault.address, gauges)
  if (!gauge) {
    return { type: '', netAPY: 0, composite: {} }
  }

  const pool = findPoolForVault(vault.address, pools)
  const fraxPool = findFraxPoolForVault(vault.address, fraxPools)
  const subgraphItem = findSubgraphItemForVault(gauge.swap, subgraphData)

  type StrategyResult = {
    type: string;
    netAPY: bigint;
    boost: bigint;
    poolAPY: bigint;
    boostedAPR: bigint;
    baseAPR: bigint;
    rewardsAPY: bigint;
    cvxAPR?: bigint;
    keepCRV?: bigint;
  };

  const strategyResults = await Promise.all(
    allStrategiesForVault
      .map(async (strategy) => {
        if (!strategy.debtRatio || strategy.debtRatio === BigInt(0)) {
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

  const validResults = strategyResults.filter(Boolean) as StrategyResult[]

  if (validResults.length === 0) {
    return { type: '', netAPY: 0, composite: {} }
  }


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
    netAPY,
    boost,
    poolAPY,
    boostedAPR,
    baseAPR,
    cvxAPR,
    rewardsAPY,
    keepCRV
  }
}
