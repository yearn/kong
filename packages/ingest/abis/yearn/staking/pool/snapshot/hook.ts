import { z } from 'zod'
import { parseAbi, zeroAddress } from 'viem'
import { rpcs } from '../../../../../rpcs'
import { zhexstring } from 'lib/types'
import { fetchOrExtractErc20 } from '../../../lib'
import { fetchErc20PriceUsd } from '../../../../../prices'
import db from '../../../../../db'

export const ResultSchema = z.object({
  address: zhexstring,
  available: z.boolean(),
  source: z.string(),
  rewards: z.array(z.object({
    address: zhexstring,
    name: z.string(),
    symbol: z.string(),
    decimals: z.number(),
    price: z.number(),
    isFinished: z.boolean(),
    finishedAt: z.bigint(),
    apr: z.number(),
    perWeek: z.number()
  }))
})

export const SnapshotSchema = z.object({
  total_supply: z.bigint({ coerce: true }),
  staking_token: zhexstring
})

const SECONDS_PER_YEAR = 31_556_952
const SECONDS_PER_WEEK = 604_800

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const snapshot = SnapshotSchema.parse(data)

  // Get thing defaults to retrieve source and vault
  const thingResult = await db.query(
    'SELECT defaults FROM thing WHERE chain_id = $1 AND address = $2 AND label = \'stakingPool\'',
    [chainId, address]
  )

  if (thingResult.rows.length === 0) {
    return {
      address,
      available: false,
      source: 'Unknown',
      rewards: []
    }
  }

  const defaults = thingResult.rows[0].defaults
  const source = defaults.source || 'Unknown'
  const vaultAddress = defaults.vault as `0x${string}`

  // Fetch vault price and decimals
  const vaultToken = await fetchOrExtractErc20(chainId, vaultAddress)
  const { priceUsd: vaultPrice } = await fetchErc20PriceUsd(chainId, vaultAddress)

  // Fetch reward tokens
  const rewardTokens: `0x${string}`[] = []
  let index = 0

  while (true) {
    try {
      const token = await rpcs.next(chainId).readContract({
        address,
        functionName: 'rewardTokens',
        args: [BigInt(index)],
        abi: parseAbi(['function rewardTokens(uint256) view returns (address)'])
      })

      if (token === zeroAddress) break
      rewardTokens.push(token)
      index++

      // Safety limit
      if (index > 20) break
    } catch {
      break
    }
  }

  // Process each reward token
  const rewards = await Promise.all(rewardTokens.map(async (rewardToken) => {
    // Fetch reward data
    const rewardData = await rpcs.next(chainId).readContract({
      address,
      functionName: 'rewardData',
      args: [rewardToken],
      abi: parseAbi(['function rewardData(address) view returns (uint256 periodFinish, uint256 rate, uint256 duration, uint256 receivedReward)'])
    })

    const [periodFinish, rate, duration] = rewardData

    // Fetch reward token metadata
    const rewardTokenData = await fetchOrExtractErc20(chainId, rewardToken)
    const { priceUsd: rewardPrice } = await fetchErc20PriceUsd(chainId, rewardToken)

    // Calculate APR
    const now = BigInt(Math.floor(Date.now() / 1000))
    const isFinished = periodFinish < now

    let apr = 0
    let perWeek = 0

    if (!isFinished && snapshot.total_supply > 0n) {
      // Calculate reward per duration
      const rewardPerDuration = rate * duration

      // Normalize total supply
      const normalizedTotalSupply = Number(snapshot.total_supply) / (10 ** Number(vaultToken.decimals))

      // Calculate APR
      const rewardPerDurationNormalized = Number(rewardPerDuration) / (10 ** Number(rewardTokenData.decimals))
      apr = (rewardPerDurationNormalized * rewardPrice) / (vaultPrice * normalizedTotalSupply)
      apr = (apr / Number(duration)) * SECONDS_PER_YEAR

      // Calculate per week
      perWeek = (Number(rate) / (10 ** Number(rewardTokenData.decimals))) * SECONDS_PER_WEEK
    }

    return {
      address: rewardToken,
      name: rewardTokenData.name,
      symbol: rewardTokenData.symbol,
      decimals: rewardTokenData.decimals,
      price: rewardPrice,
      isFinished,
      finishedAt: periodFinish,
      apr,
      perWeek
    }
  }))

  return {
    address,
    available: rewards.length > 0,
    source,
    rewards
  }
}
