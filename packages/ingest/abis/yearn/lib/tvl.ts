import { z } from 'zod'
import { EvmAddressSchema, Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { fetchErc20PriceUsd } from '../../../prices'
import { rpcs } from '../../../rpcs'
import { parseAbi } from 'viem'
import { compare } from 'compare-versions'
import { normalize, priced } from 'lib/math'
import { extractWithdrawalQueue } from '../2/vault/snapshot/hook'
import { Data } from '../../../extract/timeseries'
import { estimateHeight, getBlock } from 'lib/blocks'
import { first } from '../../../db'

export default async function _process(chainId: number, address: `0x${string}`, data: Data, components?: boolean): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  let blockNumber: bigint = 0n
  let latest: boolean = false
  if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
    latest = true;
    ({ number: blockNumber } = await getBlock(chainId))
  } else {
    const estimate = await estimateHeight(chainId, data.blockTime);
    ({ number: blockNumber } = await getBlock(chainId, estimate))
  }

  const vault = await first<Thing>(ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, 'vault']
  )

  if (!vault) return []

  const { tvl, delegatedTvl, totalAssets, delegatedAssets, priceUsd } = await _compute(vault, blockNumber, latest)

  if (components) {
    // componentized outputs
    return OutputSchema.array().parse([{
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'tvl', value: tvl
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'delegated', value: delegatedTvl
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'totalAssets', value: normalize(totalAssets, vault.defaults.decimals) || 0
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'delegatedAssets', value: normalize(delegatedAssets, vault.defaults.decimals) || 0
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'priceUsd', value: priceUsd
    }])

  } else {
    // legacy tvl output
    return OutputSchema.array().parse([{
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'tvl', value: tvl
    }])

  }
}

export async function _compute(vault: Thing, blockNumber: bigint, latest = false, toleranceSeconds?: number) {
  const { chainId, address, defaults } = vault
  const { apiVersion, asset, decimals } = z.object({
    apiVersion: z.string(),
    asset: EvmAddressSchema,
    decimals: z.number({ coerce: true })
  }).parse(defaults)

  const { priceUsd } = await fetchErc20PriceUsd(chainId, asset, blockNumber, latest, toleranceSeconds)

  const totalAssets = await extractTotalAssets(chainId, address, blockNumber)

  if(!totalAssets) return { priceUsd, tvl: 0, totalAssets, delegatedAssets: 0n }

  const delegatedAssets = compare(apiVersion, '3.0.0', '<')
    ? await extractTotalDelegatedAssets(chainId, address, blockNumber)
    : 0n

  const tvl = priced(totalAssets, decimals, priceUsd)
  const delegatedTvl = priced(delegatedAssets, decimals, priceUsd)

  return { priceUsd, tvl, delegatedTvl, totalAssets, delegatedAssets }
}

export async function extractTotalDelegatedAssets(chainId: number, vault: `0x${string}`, blockNumber: bigint) {
  const strategies = await extractWithdrawalQueue(chainId, vault, blockNumber)
  const delegatedAssets = await extractDelegatedAssets(chainId, strategies, blockNumber)
  return delegatedAssets.reduce((acc, { delegatedAssets }) => acc + delegatedAssets, 0n)
}

async function extractDelegatedAssets(chainId: number, addresses: `0x${string}` [], blockNumber: bigint) {
  const results = [] as { address: `0x${string}`, delegatedAssets: bigint } []

  const contracts = addresses.map(address => ({
    args: [], address, functionName: 'delegatedAssets', abi: parseAbi(['function delegatedAssets() view returns (uint256)'])
  }))

  const multicallresults = await rpcs.next(chainId, blockNumber).multicall({ contracts, blockNumber})

  multicallresults.forEach((result, index) => {
    const delegatedAssets = result.status === 'failure'
      ? 0n
      : BigInt(result.result as bigint)

    results.push({ address: addresses[index], delegatedAssets })
  })

  return results
}

export async function extractTotalAssets(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address, functionName: 'totalAssets', abi: parseAbi(['function totalAssets() view returns (uint256)']) },
      { address, functionName: 'estimatedTotalAssets', abi: parseAbi(['function estimatedTotalAssets() view returns (uint256)']) }
    ],
    blockNumber
  })

  if (!multicall.some(result => result.status === 'success')) {
    console.warn('🚨', 'extractTotalAssets', 'multicall fail', chainId, address, blockNumber)
    return undefined
  }

  const totalAssets = multicall[0].status === 'success' ? BigInt(multicall[0].result as bigint) : undefined
  const estimated = multicall[1].status === 'success' ? BigInt(multicall[1].result as bigint) : undefined
  return totalAssets ?? estimated ?? undefined
}
