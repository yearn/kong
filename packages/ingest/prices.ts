import { arbitrum, base, fantom, mainnet, optimism } from 'viem/chains'
import { parseAbi } from 'viem'
import { cache } from 'lib/cache'
import { rpcs } from './rpcs'
import db from './db'
import { Price, PriceSchema } from 'lib/types'
import { mq } from 'lib'
import { getBlockNumber, getBlockTime } from 'lib/blocks'

export const lens = {
  [mainnet.id]: '0x83d95e0D5f402511dB06817Aff3f9eA88224B030' as `0x${string}`,
  [optimism.id]: '0xB082d9f4734c535D9d80536F7E87a6f4F471bF65' as `0x${string}`,
  [fantom.id]: '0x57AA88A0810dfe3f9b71a9b179Dd8bF5F956C46A' as `0x${string}`,
  [base.id]: '0xE0F3D78DB7bC111996864A32d22AB0F59Ca5Fa86' as `0x${string}`,
  [arbitrum.id]: '0x043518AB266485dC085a1DB095B8d9C2Fc78E9b9' as `0x${string}`
}

export async function fetchErc20PriceUsd(chainId: number, token: `0x${string}`, blockNumber?: bigint, latest = false): Promise<{ priceUsd: number, priceSource: string }>{
  if (!blockNumber) {
    blockNumber = await getBlockNumber(chainId)
    latest = true
  }

  return cache.wrap(`fetchErc20PriceUsd:${chainId}:${token}:${blockNumber}`, async () => {
    return await __fetchErc20PriceUsd(chainId, token, blockNumber!, latest)
  }, 30_000)
}

async function __fetchErc20PriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint, latest = false) {
  let result: Price | undefined

  if(latest) {
    result = await fetchYDaemonPriceUsd(chainId, token, blockNumber)
    await mq.add(mq.job.load.price, result)
    if(result) return result
  }

  result = await fetchDbPriceUsd(chainId, token, blockNumber)
  if(result) return result

  result = await fetchLensPriceUsd(chainId, token, blockNumber)
  if(result) {
    await mq.add(mq.job.load.price, result)
    return result
  }

  if(JSON.parse(process.env.YPRICE_ENABLED || 'false')) {
    result = await fetchYPriceUsd(chainId, token, blockNumber)
    if(result) {
      await mq.add(mq.job.load.price, result)
      return result
    }
  }

  console.warn('🚨', 'no price', chainId, token, blockNumber)
  const empty = { chainId, address: token, priceUsd: 0, priceSource: 'na', blockNumber, blockTime: await getBlockTime(chainId, blockNumber) }
  await mq.add(mq.job.load.price, empty)
  return empty
}

async function fetchYPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if(!process.env.YPRICE_API) return undefined

  try {
    const url = `${process.env.YPRICE_API}/get_price/${chainId}/${token}?block=${blockNumber}`
    const result = await fetch(url, {
      headers: {
        'X-Signature': process.env.YPRICE_API_X_SIGNATURE || '',
        'X-Signer': process.env.YPRICE_API_X_SIGNER || ''
      }
    })

    const priceUsd = Number(await result.json())
    if(priceUsd === 0) return undefined

    return PriceSchema.parse({ 
      chainId,
      address: token,
      priceUsd,
      priceSource: 'lens',
      blockNumber,
      blockTime: await getBlockTime(chainId, blockNumber)
    })

  } catch(error) {
    console.warn('🚨', 'yprice failed', chainId, token, blockNumber)
    return undefined
  }
}

async function fetchDbPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  const result = await db.query(
    `SELECT
      chain_id as "chainId",
      address,
      price_usd as "priceUsd",
      price_source as "priceSource",
      block_number as "blockNumber",
      block_time as "blockTime"
    FROM price WHERE chain_id = $1 AND address = $2 AND block_number = $3`,
    [chainId, token, blockNumber]
  )
  if(result.rows.length === 0) return undefined
  return PriceSchema.parse(result.rows[0])
}

async function fetchLensPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  if(!(chainId in lens)) return undefined

  try {
    const priceUSDC = await rpcs.next(chainId, blockNumber).readContract({
      address: lens[chainId as keyof typeof lens],
      functionName: 'getPriceUsdcRecommended',
      args: [ token ],
      abi: parseAbi(['function getPriceUsdcRecommended(address tokenAddress) view returns (uint256)']),
      blockNumber
    }) as bigint

    if(priceUSDC === 0n) return undefined

    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd: Number(priceUSDC * 10_000n / BigInt(10 ** 6)) / 10_000, 
      priceSource: 'lens',
      blockNumber, 
      blockTime: await getBlockTime(chainId, blockNumber)
    })

  } catch(error) {
    console.warn('🚨', 'lens price failed', error)
    return undefined
  }
}

async function fetchAllYDaemonPrices() {
  if(!process.env.YDAEMON_API) throw new Error('!YDAEMON_API')
  return cache.wrap('fetchAllYDaemonPrices', async () => {
    const url = `${process.env.YDAEMON_API}/prices/all?humanized=true`
    const result = await fetch(url)
    const json = await result.json()
    return lowercaseAddresses(json)
  }, 60_000)
}

type YDaemonPrices = {
  [key: string]: {
      [key: string]: number
  }
}

function lowercaseAddresses(data: YDaemonPrices): YDaemonPrices {
  const result: YDaemonPrices = {}
  for (const outerKey in data) {
    result[outerKey] = {}
    for (const innerKey in data[outerKey]) {
      result[outerKey][innerKey.toLowerCase()] = data[outerKey][innerKey]
    }
  }
  return result
}

async function fetchYDaemonPriceUsd(chainId: number, token: `0x${string}`, blockNumber: bigint) {
  try {
    const prices = await fetchAllYDaemonPrices()
    const price = prices[chainId.toString()]?.[token.toLowerCase()] || 0
    if(isNaN(price)) return undefined
    return PriceSchema.parse({
      chainId,
      address: token,
      priceUsd: price, 
      priceSource: 'ydaemon',
      blockNumber, 
      blockTime: await getBlockTime(chainId, blockNumber)
    })
  } catch(error) {
    console.warn('🚨', 'ydaemon price failed', error)
    return undefined
  }
}
