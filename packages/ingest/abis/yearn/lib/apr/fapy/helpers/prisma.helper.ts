import { BigNumber } from '@ethersproject/bignumber'
import { createPublicClient, http, zeroAddress } from 'viem'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { yprismaReceiverAbi } from '../abis/yprisma-receiver.abi'

export async function getPrismaAPY(chainID: number, prismaReceiver: string): Promise<[number, number]> {
  const client = createPublicClient({
    transport: http(process.env[`RPC_FULL_NODE_${chainID}`])
  })

  try {
    // Parallelize contract reads
    const [rewardRate, totalSupply, lpToken] = await Promise.all([
      client.readContract({
        address: prismaReceiver as `0x${string}`,
        abi: yprismaReceiverAbi,
        functionName: 'rewardRate',
        args: [zeroAddress, BigNumber.from(0)]
      }) as Promise<number>,
      client.readContract({
        address: prismaReceiver as `0x${string}`,
        abi: yprismaReceiverAbi,
        functionName: 'totalSupply',
      }) as Promise<number>,
      client.readContract({
        address: prismaReceiver as `0x${string}`,
        abi: yprismaReceiverAbi,
        functionName: 'lpToken',
      }) as Promise<`0x${string}`>
    ])

    const rate = Number(rewardRate.toString()) / 1e18
    const supply = Number(totalSupply.toString()) / 1e18

    const prismaTokenAddress = '0xdA47862a83dac0c112BA89c6abC2159b95afd71C'

    // Parallelize token price fetches
    const [tokenPricePrisma, tokenPriceLpToken] = await Promise.all([
      getTokenPrice(chainID, prismaTokenAddress),
      getTokenPrice(chainID, lpToken as `0x${string}`)
    ])

    let prismaPrice = 0
    if (tokenPricePrisma) {
      prismaPrice = Math.floor(parseFloat(tokenPricePrisma.toString()) * 1e18)
    }

    let lpTokenPrice = 0
    if (tokenPriceLpToken) {
      lpTokenPrice = Math.floor(parseFloat(tokenPriceLpToken.toString()) * 1e18)
    }

    const secondsPerYear = 31536000
    const prismaAPR = (rate * prismaPrice * secondsPerYear) / (supply * lpTokenPrice)

    const compoundingPeriodsPerYear = 365
    const scale = 1e18
    const scaledAPR = prismaAPR / compoundingPeriodsPerYear
    const prismaAPY = ((scale + scaledAPR) ** compoundingPeriodsPerYear) / scale - scale

    return [prismaAPR, prismaAPY]
  } catch (error) {
    console.error('Error in getPrismaAPY:', error)
    return [0, 0]
  }
}

async function getTokenPrice(chainID: number, tokenAddress: string) {
  const { priceUsd } = await fetchErc20PriceUsd(chainID, tokenAddress as `0x${string}`, undefined, true)
  return priceUsd
}
