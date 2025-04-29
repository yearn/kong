import { StrategyWithIndicators, Thing } from 'lib/types'
import { createPublicClient, http, zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../prices'
import { BigNumber } from '@ethersproject/bignumber'
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
// Strategy type detection functions
export function isCurveStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
  return (
    (vaultName?.includes('curve') || vaultName?.includes('convex') || vaultName?.includes('crv')) &&
    !vaultName?.includes('ajna-')
  )
}

export function isConvexStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
  return vaultName?.includes('convex')
}

export function isFraxStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
  return vaultName?.includes('frax')
}

export function isPrismaStrategy(vault: Thing & { name: string }) {
  const vaultName = vault?.name.toLowerCase()
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

export function getPoolPrice(gauge: Gauge) {
  let virtualPrice = BigInt(0)
  if (gauge.virtualPrice) {
    virtualPrice = BigInt(gauge.virtualPrice)
  }
  const divisor = 10n**18n
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

export async function determineCurveKeepCRV(strategy: StrategyWithIndicators, chainId: number) {
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
  const debtRatio = data.lastDebtRatio
  const performanceFee = data.strategy.performanceFee
  const managementFee = data.strategy.managementFee
  const oneMinusPerfFee = 1 - (performanceFee || 0)

  let crvAPY = data.baseAPY * yboost
  crvAPY = crvAPY + data.rewardAPY

  const keepCRVRatio = 1 + Number(keepCrv)
  let grossAPY = data.baseAPY * yboost
  grossAPY = grossAPY * keepCRVRatio
  grossAPY = grossAPY + data.rewardAPY
  grossAPY = grossAPY + data.poolAPY

  let netAPY = grossAPY + oneMinusPerfFee

  if(netAPY > (managementFee || 0)) {
    netAPY = netAPY - (managementFee || 0)
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

export async function calculateConvexForwardAPY(data: {
  gaugeAddress: `0x${string}`,
  strategy: StrategyWithIndicators,
  baseAssetPrice: number,
  poolPrice: bigint,
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
  const oneMinusPerfFee = 1 - (performanceFee || 0)

  const {crvAPR, cvxAPR, crvAPY, cvxAPY } = await getCVXPoolAPY(chainId, strategy.address, baseAssetPrice)

  const {totalRewardsAPY} = await getConvexRewardAPY(chainId, strategy.address, baseAssetPrice, poolPrice)
  const keepCRVRatio = 1 - Number(keepCRV)
  let grossApy = crvAPY * keepCRVRatio
  grossApy = grossApy + Number(rewardAPY) + Number(poolDailyAPY) + cvxAPY

  let netApy = grossApy * oneMinusPerfFee
  if (netApy > (managementFee || 0)) {
    netApy = netApy - (managementFee || 0)
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
  strategy: StrategyWithIndicators,
  baseAssetPrice: number,
  poolPrice: bigint,
  baseAPY: number,
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

  const baseConvexStrategyData = await calculateConvexForwardAPY({
    gaugeAddress: data.gaugeAddress,
    strategy: data.strategy,
    baseAssetPrice: data.baseAssetPrice,
    poolPrice: data.poolPrice,
    baseAPY: data.baseAPY,
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

export async function calculateGaugeBaseAPR(gauge: Gauge, crvTokenPrice, poolPrice, baseAssetPrice) {
  const inflationRate = BigInt(gauge.gauge_controller.inflation_rate)
  const gaugeWeight = BigInt(gauge.gauge_controller.gauge_relative_weight)
  const secondPerYear = 31556952
  const workingSupply = BigInt(gauge.gauge_data.working_supply)
  const perMaxBoost = 0.4

  let baseAPR = inflationRate * gaugeWeight
  baseAPR = BigNumber.from(baseAPR).mul(BigNumber.from(secondPerYear)).div(workingSupply).toBigInt()
  baseAPR = BigNumber.from(baseAPR).mul(perMaxBoost).div(poolPrice).toBigInt()
  baseAPR = baseAPR * crvTokenPrice
  baseAPR = baseAPR / baseAssetPrice

  const baseAPY = convertFloatAPRToAPY(baseAPR, 365/15)

  return { baseAPR, baseAPY }
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
    keepCRV?: bigint;
  } | null > {
  console.log({
    gauge
  })
  const baseAssetPrice = Number(gauge.lpTokenPrice || 0)

  const { priceUsd } = await fetchErc20PriceUsd(chainId, CRV_TOKEN_ADDRESS[chainId], undefined, true)
  const crvPrice = priceUsd

  const poolPrice = getPoolPrice(gauge)

  const { baseAPY } = await calculateGaugeBaseAPR(gauge, crvPrice, poolPrice, baseAssetPrice)

  const rewardAPY = getRewardsAPY(chainId, pool as CrvPool)

  const poolWeeklyAPY = getPoolWeeklyAPY(subgraphItem)
  const poolDailyAPY = getPoolDailyAPY(subgraphItem)


  if (isPrismaStrategy(vault)) {
    return calculatePrismaForwardAPR({
      vault,
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice: Number(baseAssetPrice),
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
      chainId
    })
  }

  if (isFraxStrategy(vault)) {
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

  if (isConvexStrategy(vault)) {
    return calculateConvexForwardAPY({
      gaugeAddress: gauge.gauge as `0x${string}`,
      strategy,
      baseAssetPrice,
      poolPrice,
      baseAPY,
      rewardAPY,
      poolDailyAPY,
      chainId,
      lastDebtRatio: strategy.debtRatio || 0
    })
  }

  return calculateCurveForwardAPY({
    gaugeAddress: gauge.gauge as `0x${string}`,
    strategy,
    baseAPY: baseAPY,
    rewardAPY,
    poolAPY: poolWeeklyAPY,
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

  type StrategyResult = {
    type: string;
    netAPY: number;
    boost: number;
    poolAPY: number;
    boostedAPR: number;
    baseAPR: number;
    rewardsAPY: number;
    cvxAPR?: number;
    keepCRV?: bigint;
  };
  const strategyResults = await Promise.all(
    allStrategiesForVault
      .map(async (strategy) => {
        console.log({
          strategy
        })
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
