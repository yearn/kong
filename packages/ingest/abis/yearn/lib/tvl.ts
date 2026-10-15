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
import { first, some } from '../../../db'
import { endOfDay } from 'lib/dates'
import { readAuthoritativeAssets } from './tranches/assets'

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

  const { tvl, delegatedTvl, totalAssets, delegatedAssets, priceUsd, priceSource, decimals } = await _compute(vault, blockNumber, latest)

  // readAuthoritativeAssets returns undefined on read failure; skip emitting a false zero (a genuine empty vault is 0n)
  if (totalAssets === undefined) return []

  // 'unavailable' (price service failure) still writes rows for past days: null for
  // the usd components, real values for the on-chain ones. Returning [] left the day
  // permanently missing, so every fanout cycle re-enqueued it forever. Null days heal
  // by replay (fanout/timeseries.ts).
  const priceUnavailable = priceSource === 'unavailable'

  // The current day is skipped outright: fanout re-extracts it every cycle anyway, and
  // a null row at today's series_time would shadow yesterday's real value in
  // latest-row queries.
  if (priceUnavailable && latest) return []

  const usdUnknown = priceUnavailable && totalAssets !== 0n

  // findMissingDays counts a null row as computed, so overwriting a real value here
  // would lose it for good.
  if (priceUnavailable && await hasComputedTvl(chainId, address, data.outputLabel, data.blockTime)) return []

  if (components) {
    // componentized outputs
    return OutputSchema.array().parse([{
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'tvl', value: usdUnknown ? null : tvl
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'delegated', value: usdUnknown ? null : delegatedTvl
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'totalAssets', value: normalize(totalAssets, decimals) || 0
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'delegatedAssets', value: normalize(delegatedAssets, decimals) || 0
    }, {
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'priceUsd', value: priceUnavailable ? null : priceUsd
    }])

  } else {
    // legacy tvl output
    return OutputSchema.array().parse([{
      chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
      component: 'tvl', value: usdUnknown ? null : tvl
    }])

  }
}

async function hasComputedTvl(chainId: number, address: `0x${string}`, label: string, blockTime: bigint) {
  return await some(
    `SELECT 1 FROM output
     WHERE chain_id = $1 AND address = $2 AND label = $3 AND component = 'tvl'
       AND series_time = to_timestamp($4::double precision) AND value IS NOT NULL`,
    [chainId, address, label, Number(endOfDay(blockTime))]
  )
}

export async function _compute(vault: Thing, blockNumber: bigint, latest = false) {
  const { chainId, address, defaults } = vault
  const { apiVersion, asset, decimals } = z.object({
    apiVersion: z.string().optional(),
    asset: EvmAddressSchema,
    decimals: z.number({ coerce: true })
  }).parse(defaults)

  const { priceUsd, priceSource } = await fetchErc20PriceUsd(chainId, asset, blockNumber, latest)

  // tranche vaults resolve to controller-backed assets; every other vault to its
  // own totalAssets(). Both arrive through the same reader so tvl-c keeps one shape.
  const totalAssets = await readAuthoritativeAssets(vault, blockNumber)

  // no assets means no real tvl; keep the real priceUsd for the price component
  if (!totalAssets) return { priceUsd, priceSource, tvl: 0, delegatedTvl: 0, totalAssets, delegatedAssets: 0n, decimals }

  // pre-3.0.0 vaults delegate assets to strategies; v3 and bare erc4626 (no apiVersion) do not
  const delegatedAssets = apiVersion && compare(apiVersion, '3.0.0', '<')
    ? await extractTotalDelegatedAssets(chainId, address, blockNumber)
    : 0n

  // no price means no usd tvl, but the on-chain asset components are still real
  const tvl = priceUsd ? priced(totalAssets, decimals, priceUsd) : 0
  const delegatedTvl = priceUsd ? priced(delegatedAssets, decimals, priceUsd) : 0

  return { priceUsd, priceSource, tvl, delegatedTvl, totalAssets, delegatedAssets, decimals }
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

