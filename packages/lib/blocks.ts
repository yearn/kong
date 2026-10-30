import { z } from 'zod'
import { cache } from './cache'
import { rpcs } from './rpcs'
import * as dates from './dates'

export const BlockSchema = z.object({
  chainId: z.number(),
  number: z.bigint({ coerce: true }),
  timestamp: z.bigint({ coerce: true })
})

export type Block = z.infer<typeof BlockSchema>

export async function getBlockNumber(chainId: number, blockNumber?: bigint): Promise<bigint> {
  return (await getBlock(chainId, blockNumber)).number
}

export async function getBlockTime(chainId: number, blockNumber?: bigint): Promise<bigint> {
  return (await getBlock(chainId, blockNumber)).timestamp
}

// TTLs derived from the indexing workload, not from block immutability. The
// head is pinned for one 15-minute indexing cycle so every job in a cycle (apy
// anchors, timeseries bounds, event stride planning) sees one consistent height
// per chain, and any reorg is picked up next cycle — this also collapses the
// estimateHeight storm to deterministic cache hits. Historical blocks only need
// to outlive the backfill reuse window: sweeps re-probe the same day-boundary
// blocks for hours, then never again. Only {number,timestamp} is cached.
const HEAD_BLOCK_TTL = 15 * 60 * 1000
const HISTORICAL_BLOCK_TTL = 24 * 60 * 60 * 1000
const HEIGHT_ESTIMATE_TTL = 10 * 1000
const HISTORICAL_HEIGHT_AGE = 24n * 60n * 60n

export async function getBlock(chainId: number, blockNumber?: bigint): Promise<Block> {
  const ttl = blockNumber === undefined ? HEAD_BLOCK_TTL : HISTORICAL_BLOCK_TTL
  const result = cache.wrap(`getBlock:${chainId}:${blockNumber}`, async () => {
    const block = await __getBlock(chainId, blockNumber)
    return BlockSchema.parse({
      chainId,
      number: block.number,
      timestamp: block.timestamp
    })
  }, ttl)
  return BlockSchema.parse(await result)
}

async function __getBlock(chainId: number, blockNumber?: bigint) {
  if (blockNumber !== undefined) {
    const { number: height } = await getBlock(chainId)
    return rpcs.next(chainId, useArchiveNode(height, blockNumber)).getBlock({ blockNumber })
  } else {
    return await rpcs.next(chainId).getBlock()
  }
}

export async function getDefaultStartBlockNumber(chainId: number): Promise<bigint> {
  const result = cache.wrap(`getDefaultStartBlock:${chainId}`, async () => {
    return await estimateHeight(chainId, dates.DEFAULT_START())
  }, 10_000)
  return BigInt(await result)
}

export async function estimateHeight(chainId: number, timestamp: bigint): Promise<bigint> {
  // The v2 key stores metadata so historical results can use a longer TTL while
  // moving-head clamps remain short-lived. The versioned key avoids reusing the
  // previous scalar cache value with a different shape.
  const result = cache.wrap(`estimateHeight:v2:${chainId}:${timestamp}`, async () => {
    const estimate = await estimateHeightManual(chainId, timestamp)
    return { height: estimate.height.toString(), historical: estimate.historical }
  }, value => value.historical ? HISTORICAL_BLOCK_TTL : HEIGHT_ESTIMATE_TTL)
  return BigInt((await result).height)
}

export async function __estimateHeight(chainId: number, timestamp: bigint) {
  return (await estimateHeightManual(chainId, timestamp)).height
}

// interpolation search over (near-linear, monotonic) block timestamps: picks each probe
// by linear time->block estimate instead of the midpoint, converging in ~O(log log n)
// getBlock calls (~4) vs binary search's ~24. each getBlock is cached, so this collapses
// the dominant RPC cost of timestamp->block resolution.
const FIRST_BLOCK: Record<number, bigint> = { 10: 105235063n }

type HeightEstimate = { height: bigint, historical: boolean }

async function estimateHeightManual(chainId: number, timestamp: bigint): Promise<HeightEstimate> {
  const top = await getBlock(chainId)
  let hi = top.number, hiTime = top.timestamp
  // A timestamp at or after the observed head is a clamp. Its answer must
  // refresh frequently while the chain advances, even when wall-clock time
  // makes the requested timestamp look old (for example on a stalled chain).
  if (timestamp >= hiTime) return { height: hi, historical: false }
  const targetIsHistorical = timestamp <= hiTime - HISTORICAL_HEIGHT_AGE

  let lo = FIRST_BLOCK[chainId] ?? 1n
  let loTime: bigint | undefined = await getBlockTime(chainId, lo).catch(() => undefined)
  if (loTime !== undefined && timestamp <= loTime) {
    return {
      height: lo,
      historical: targetIsHistorical && loTime <= top.timestamp - HISTORICAL_HEIGHT_AGE
    }
  }

  while (hi - lo > 1n) {
    let probe = loTime !== undefined && hiTime > loTime
      ? lo + ((hi - lo) * (timestamp - loTime)) / (hiTime - loTime)
      : (lo + hi) / 2n
    if (probe <= lo) probe = lo + 1n
    else if (probe >= hi) probe = hi - 1n
    const block = await getBlock(chainId, probe)
    if (block.timestamp < timestamp) { lo = probe; loTime = block.timestamp }
    else { hi = probe; hiTime = block.timestamp }
  }

  // A sparse or stalled chain can have an old target timestamp but resolve to
  // a block near the observed head. Only retain the long TTL when the resolved
  // block itself is at least a day behind that head.
  return {
    height: hi,
    historical: targetIsHistorical && hiTime <= top.timestamp - HISTORICAL_HEIGHT_AGE
  }
}

export async function estimateCreationBlock(chainId: number, contract: `0x${string}`): Promise<Block> {
  const result = cache.wrap(`estimateCreationBlock:${chainId}:${contract}`, async () => {
    return await __estimateCreationBlock(chainId, contract)
  }, 10_000)
  return BlockSchema.parse(await result)
}

// use bin search to estimate contract creat block
// doesn't account for CREATE2 or SELFDESTRUCT
// adapted from https://github.com/BobTheBuidler/ypricemagic/blob/5ba16b25302b47539b4e5a996554ba4c0a70e7c7/y/contracts.py#L68
export async function __estimateCreationBlock(chainId: number, contract: `0x${string}`): Promise<Block> {
  let counter = 0
  const label = `🕊 __estimateCreationBlock ${chainId} ${contract}`
  console.time(label)
  const height = await rpcs.next(chainId).getBlockNumber()
  let lo = 0n, hi = height, mid = lo + (hi - lo) / 2n
  while (hi - lo > 1n) {
    try {
      const bytecode = await rpcs.next(chainId, useArchiveNode(height, mid)).getBytecode({ address: contract, blockNumber: mid })
      if(!bytecode || bytecode.length === 0) { lo = mid } else { hi = mid }

    } catch (error) {
      lo = mid

    } finally {
      mid = lo + (hi - lo) / 2n
      counter++

    }
  }
  console.log('💥', 'estimateCreationBlock', chainId, contract, counter, hi)
  console.timeEnd(label)
  return await getBlock(chainId, hi)
}

const FULL_NODE_DEPTH = BigInt(process.env.FULL_NODE_DEPTH || 400)

function useArchiveNode(height: bigint, blockNumber?: bigint) {
  if (blockNumber === undefined) return false
  return blockNumber < height - FULL_NODE_DEPTH
}
