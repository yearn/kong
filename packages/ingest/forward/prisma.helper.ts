import { ethers } from 'ethers'
import { createPublicClient, http } from 'viem'
import { yprismaReceiverAbi } from './yprisma-receiver.abi'

export async function getPrismaAPY(chainID: number, prismaReceiver: string): Promise<[bigint, bigint]> {
  const client = createPublicClient({
    transport: http(process.env[`RPC_FULL_NODE_${chainID}`])
  })


  try {

    const rewardRate = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'rewardRate',
      args: [ethers.constants.AddressZero, ethers.BigNumber.from(0)]
    }) as any

    const totalSupply = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'totalSupply',
    }) as any

    const lpToken = await client.readContract({
      address: prismaReceiver as `0x${string}`,
      abi: yprismaReceiverAbi,
      functionName: 'lpToken',
    })

    const rate = BigInt(rewardRate.toString()) / BigInt(10) ** BigInt(18)
    const supply = BigInt(totalSupply.toString()) / BigInt(10) ** BigInt(18)

    let prismaPrice = BigInt(0)
    const prismaTokenAddress = '0xdA47862a83dac0c112BA89c6abC2159b95afd71C'
    const tokenPricePrisma = await getTokenPrice(chainID, prismaTokenAddress)
    if (tokenPricePrisma) {
      prismaPrice = BigInt(Math.floor(parseFloat(tokenPricePrisma.humanizedPrice) * 1e18))
    }

    let lpTokenPrice = BigInt(0)
    const tokenPriceLpToken = await getTokenPrice(chainID, lpToken as `0x${string}`)
    if (tokenPriceLpToken) {
      lpTokenPrice = BigInt(Math.floor(parseFloat(tokenPriceLpToken.humanizedPrice) * 1e18))
    }

    const secondsPerYear = BigInt(31536000)
    const prismaAPR = (rate * prismaPrice * secondsPerYear) / (supply * lpTokenPrice)

    const compoundingPeriodsPerYear = BigInt(365)
    const scale = BigInt(1e18)
    const scaledAPR = prismaAPR / compoundingPeriodsPerYear
    const prismaAPY = ((scale + scaledAPR) ** compoundingPeriodsPerYear) / scale - scale

    return [prismaAPR, prismaAPY]
  } catch (error) {
    console.error('Error in getPrismaAPY:', error)
    return [BigInt(0), BigInt(0)]
  }
}

// @TODO: Implement this but how??
async function getTokenPrice(chainID: number, tokenAddress: string): Promise<{ humanizedPrice: string } | null> {
  // This is a placeholder function. You need to implement the actual logic to fetch token prices.
  return null
}
