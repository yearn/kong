import { ethers } from 'ethers'
import { createPublicClient, http } from 'viem'
import { fetchErc20PriceUsd } from '../../prices'
import { yprismaReceiverAbi } from '../abis/yprisma-receiver.abi'

export async function getPrismaAPY(chainID: number, prismaReceiver: string): Promise<[number, number]> {
  const client = createPublicClient({
    transport: http(process.env[`RPC_FULL_NODE_${chainID}`])
  })

  try {
    const rewardRate = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'rewardRate',
      args: [ethers.constants.AddressZero, ethers.BigNumber.from(0)]
    }) as number

    const totalSupply = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'totalSupply',
    }) as number

    const lpToken = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'lpToken',
    }) as `0x${string}`

    const rate = Number(rewardRate.toString()) / 1e18
    const supply = Number(totalSupply.toString()) / 1e18

    let prismaPrice = 0
    const prismaTokenAddress = '0xdA47862a83dac0c112BA89c6abC2159b95afd71C'
    const tokenPricePrisma = await getTokenPrice(chainID, prismaTokenAddress)
    if (tokenPricePrisma) {
      prismaPrice = Math.floor(parseFloat(tokenPricePrisma.toString()) * 1e18)
    }

    let lpTokenPrice = 0
    const tokenPriceLpToken = await getTokenPrice(chainID, lpToken as `0x${string}`)
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
