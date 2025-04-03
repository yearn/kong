import { createPublicClient, http, erc20Abi } from 'viem'
import { mainnet } from 'viem/chains'
import { CVX_TOKEN_ADDRESS } from './maps.helper'
import { convexBaseStrategyAbi } from './convex-base-strategy.abi'
import { cvxBoosterAbi } from './cvx-booster.abi'
import { crvRewardsAbi } from './crv-rewards.abi'
import { convertFloatAPRToAPY } from './calculation.helper'

export const getCVXForCRV = async (chainID: number, crvEarned: bigint): Promise<bigint> => {
  const cliffSize = BigInt('100000000000000000000000') // 1e23
  const cliffCount = BigInt('1000') // 1e3
  const maxSupply = BigInt('100000000000000000000000000') // 1e26

  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env[`RPC_FULLNODE_${chainID}`]),
  })

  const cvxTotalSupply = await client.readContract({
    address: CVX_TOKEN_ADDRESS[chainID],
    abi: erc20Abi,
    functionName: 'totalSupply',
  })

  const currentCliff = cvxTotalSupply / cliffSize
  if (currentCliff >= cliffCount) {
    return BigInt(0)
  }

  const remaining = cliffCount - currentCliff
  let cvxEarned = crvEarned * remaining / cliffCount

  const amountTillMax = maxSupply - cvxTotalSupply
  if (cvxEarned > amountTillMax) {
    cvxEarned = amountTillMax
  }

  return cvxEarned
}

interface ConvexStrategy {
  address: `0x${string}`
}

interface Price {
  humanizedPrice: bigint
}

export const getConvexRewardAPY = async (
  chainID: number,
  strategy: ConvexStrategy,
  baseAssetPrice: bigint,
  poolPrice: bigint
): Promise<{ totalRewardsAPR: bigint; totalRewardsAPY: bigint }> => {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env[`RPC_FULLNODE_${chainID}`]),
  })

  // Get reward PID from strategy
  let rewardPID: bigint
  try {
    rewardPID = await client.readContract({
      address: strategy.address,
      abi: convexBaseStrategyAbi,
      functionName: 'pid',
    }) as bigint
  } catch (error) {
    try {
      rewardPID = await client.readContract({
        address: strategy.address,
        abi: convexBaseStrategyAbi,
        functionName: 'id',
      }) as bigint
    } catch (error) {
      try {
        rewardPID = await client.readContract({
          address: strategy.address,
          abi: convexBaseStrategyAbi,
          functionName: 'fraxPid',
        }) as bigint
      } catch (error) {
        if (process.env.ENVIRONMENT === 'dev') {
          console.error(`Unable to get reward PID for convex strategy ${strategy.address}`)
        }
        return { totalRewardsAPR: BigInt(0), totalRewardsAPY: BigInt(0) }
      }
    }
  }

  // Get pool info from booster
  const poolInfo = await client.readContract({
    address: CVX_TOKEN_ADDRESS[chainID],
    abi: cvxBoosterAbi,
    functionName: 'poolInfo',
    args: [rewardPID],
  }) as { crvRewards: `0x${string}` }

  // Get rewards contract
  const rewardsLength = await client.readContract({
    address: poolInfo.crvRewards,
    abi: crvRewardsAbi,
    functionName: 'extraRewardsLength',
  }) as bigint

  const now = BigInt(Math.floor(Date.now() / 1000))
  let totalRewardsAPR = BigInt(0)

  if (rewardsLength > BigInt(0)) {
    for (let i = 0; i < Number(rewardsLength); i++) {
      try {
        const virtualRewardsPool = await client.readContract({
          address: poolInfo.crvRewards,
          abi: crvRewardsAbi,
          functionName: 'extraRewards',
          args: [BigInt(i)],
        }) as `0x${string}`

        const periodFinish = await client.readContract({
          address: virtualRewardsPool,
          abi: crvRewardsAbi,
          functionName: 'periodFinish',
        }) as bigint

        if (periodFinish < now) {
          continue
        }

        const rewardToken = await client.readContract({
          address: virtualRewardsPool,
          abi: crvRewardsAbi,
          functionName: 'rewardToken',
        }) as `0x${string}`

        // TODO: Implement GetPrice function
        const rewardTokenPrice = { humanizedPrice: BigInt(0) } as Price

        const rewardRate = await client.readContract({
          address: virtualRewardsPool,
          abi: crvRewardsAbi,
          functionName: 'rewardRate',
        }) as bigint

        const totalSupply = await client.readContract({
          address: virtualRewardsPool,
          abi: crvRewardsAbi,
          functionName: 'totalSupply',
        }) as bigint

        const tokenPrice = rewardTokenPrice.humanizedPrice
        const rewardRateNormalized = rewardRate / BigInt(1e18)
        const totalSupplyNormalized = totalSupply / BigInt(1e18)
        const secondPerYear = BigInt(31556952)

        let rewardAPRTop = rewardRateNormalized * secondPerYear
        rewardAPRTop = rewardAPRTop * tokenPrice
        let rewardAPRBottom = poolPrice / BigInt(1e18)
        rewardAPRBottom = rewardAPRBottom * baseAssetPrice
        rewardAPRBottom = rewardAPRBottom * totalSupplyNormalized
        const rewardAPR = rewardAPRTop / rewardAPRBottom

        totalRewardsAPR = totalRewardsAPR + rewardAPR
      } catch (error) {
        console.error(error)
        continue
      }
    }
  }

  const totalRewardsAPY = convertFloatAPRToAPY(totalRewardsAPR, 365/15)

  return {
    totalRewardsAPR,
    totalRewardsAPY: BigInt(totalRewardsAPY)
  }
}
