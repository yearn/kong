import { erc20Abi } from 'viem'
import { fetchErc20PriceUsd } from 'ingest/prices'
import { convertFloatAPRToAPY } from './calculation.helper'
import { CVX_TOKEN_ADDRESS } from './maps.helper'
import { convexBaseStrategyAbi, cvxBoosterAbi, crvRewardsAbi } from '../abis'
import { rpcs } from 'lib/rpcs'
import { Float } from './bignumber-float'
import { toNormalizedAmount, BigNumberInt } from './bignumber-int'

export const getCVXForCRV = async (chainID: number, crvEarned: bigint) => {
  const client = rpcs.next(chainID)

  // Constants from Go code
  const cliffSize = new Float(0).setString('100000000000000000000000')    // 1e23
  const cliffCount = new Float(0).setString('1000')                       // 1e3
  const maxSupply = new Float(0).setString('100000000000000000000000000') // 1e26

  try {
    // Get CVX total supply from contract
    const cvxTotalSupplyInt = await client.readContract({
      address: CVX_TOKEN_ADDRESS[chainID],
      abi: erc20Abi,
      functionName: 'totalSupply',
    }) as bigint

    // Convert to Float for calculations
    const cvxTotalSupply = new Float(0).setInt(new BigNumberInt(cvxTotalSupplyInt))
    const crvEarnedFloat = new Float(0).setInt(new BigNumberInt(crvEarned))

    // Calculate current cliff
    const currentCliff = new Float(0).div(cvxTotalSupply, cliffSize)

    // If current cliff >= cliff count, return zero
    if (currentCliff.gte(cliffCount)) {
      return new Float(0)
    }

    // Calculate remaining and cvxEarned
    const remaining = new Float(0).sub(cliffCount, currentCliff)
    let cvxEarned = new Float(0).mul(crvEarnedFloat, remaining)
    cvxEarned = new Float(0).div(cvxEarned, cliffCount)

    // Check amount till max supply
    const amountTillMax = new Float(0).sub(maxSupply, cvxTotalSupply)
    if (cvxEarned.gt(amountTillMax)) {
      cvxEarned = amountTillMax
    }

    // Convert back to bigint
    return cvxEarned
  } catch (error) {
    return new Float(0)
  }
}


export const getConvexRewardAPY = async (
  chainID: number,
  strategy: `0x${string}`,
  baseAssetPrice: Float,
  poolPrice: Float
): Promise<{ totalRewardsAPR: Float; totalRewardsAPY: Float }> => {
  const client = rpcs.next(chainID)

  // Get reward PID from strategy
  let rewardPID: bigint
  try {
    rewardPID = await client.readContract({
      address: strategy,
      abi: convexBaseStrategyAbi,
      functionName: 'pid',
    }) as bigint
  } catch (error) {
    try {
      rewardPID = await client.readContract({
        address: strategy,
        abi: convexBaseStrategyAbi,
        functionName: 'id',
      }) as bigint
    } catch (error) {
      try {
        rewardPID = await client.readContract({
          address: strategy,
          abi: convexBaseStrategyAbi,
          functionName: 'fraxPid',
        }) as bigint
      } catch (error) {
        return { totalRewardsAPR: new Float(0), totalRewardsAPY: new Float(0) }
      }
    }
  }

  // Get pool info from booster
  let poolInfo: { crvRewards: `0x${string}` }
  try {
    poolInfo = await client.readContract({
      address: CVX_TOKEN_ADDRESS[chainID],
      abi: cvxBoosterAbi,
      functionName: 'poolInfo',
      args: [rewardPID],
    }) as { crvRewards: `0x${string}` }
  } catch (error) {
    return { totalRewardsAPR: new Float(0), totalRewardsAPY: new Float(0) }
  }

  // Get rewards length
  let rewardsLength: bigint
  try {
    rewardsLength = await client.readContract({
      address: poolInfo.crvRewards,
      abi: crvRewardsAbi,
      functionName: 'extraRewardsLength',
    }) as bigint
  } catch (error) {
    return { totalRewardsAPR: new Float(0), totalRewardsAPY: new Float(0) }
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  let totalRewardsAPR = new Float(0)

  if (rewardsLength > BigInt(0)) {
    for (let i = 0; i < Number(rewardsLength); i++) {
      try {
        const virtualRewardsPool = await client.readContract({
          address: poolInfo.crvRewards,
          abi: crvRewardsAbi,
          functionName: 'extraRewards',
          args: [BigInt(i)],
        }) as `0x${string}`

        // Parallelize reading from virtualRewardsPool
        const [periodFinish, rewardToken, rewardRateInt, totalSupplyInt] = await Promise.all([
          client.readContract({
            address: virtualRewardsPool,
            abi: crvRewardsAbi,
            functionName: 'periodFinish',
          }) as Promise<bigint>,
          client.readContract({
            address: virtualRewardsPool,
            abi: crvRewardsAbi,
            functionName: 'rewardToken',
          }) as Promise<`0x${string}`>,
          client.readContract({
            address: virtualRewardsPool,
            abi: crvRewardsAbi,
            functionName: 'rewardRate',
          }) as Promise<bigint>,
          client.readContract({
            address: virtualRewardsPool,
            abi: crvRewardsAbi,
            functionName: 'totalSupply',
          }) as Promise<bigint>
        ])

        if (periodFinish < now) {
          continue
        }

        // Fetch price with fallback if not available
        const { priceUsd: rewardTokenPrice } = await fetchErc20PriceUsd(chainID, rewardToken, undefined, true)
        if (!rewardTokenPrice) {
          continue
        }

        // Convert to Float following Go implementation pattern exactly
        const tokenPrice = new Float(rewardTokenPrice) // rewardTokenPrice.HumanizedPrice equivalent

        // helpers.ToNormalizedAmount equivalent - using the proper function
        const rewardRate = toNormalizedAmount(new BigNumberInt(rewardRateInt), 18)
        const totalSupply = toNormalizedAmount(new BigNumberInt(totalSupplyInt), 18)
        const secondPerYear = new Float(0).setFloat64(31556952)

        // Following the Go implementation calculations exactly
        let rewardAPRTop = new Float(0).mul(rewardRate, secondPerYear)
        rewardAPRTop = new Float(0).mul(rewardAPRTop, tokenPrice)

        let rewardAPRBottom = new Float(0).div(poolPrice, new Float(1)) // storage.ONE equivalent
        rewardAPRBottom = new Float(0).mul(rewardAPRBottom, baseAssetPrice)
        rewardAPRBottom = new Float(0).mul(rewardAPRBottom, totalSupply)

        const rewardAPR = new Float(0).div(rewardAPRTop, rewardAPRBottom)
        totalRewardsAPR = new Float(0).add(totalRewardsAPR, rewardAPR)
      } catch (error) {
        continue
      }
    }
  }

  const [totalRewardsAPRFloat64] = totalRewardsAPR.toFloat64()
  const totalRewardsAPY = new Float(convertFloatAPRToAPY(totalRewardsAPRFloat64, 365/15))

  return {
    totalRewardsAPR: totalRewardsAPR,
    totalRewardsAPY: totalRewardsAPY
  }
}
