import { z } from 'zod'
import { cache } from './cache'
import { rpcs } from './rpcs'
import { dates } from '.'

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
  const result = cache.wrap(`estimateHeight:${chainId}:${timestamp}`, async () => {
    return BigInt(await __estimateHeight(chainId, timestamp))
  }, 10_000)
  return BigInt(await result)
}

export async function __estimateHeight(chainId: number, timestamp: bigint) {
  return await estimateHeightManual(chainId, timestamp)
}

// interpolation search over (near-linear, monotonic) block timestamps: picks each probe
// by linear time->block estimate instead of the midpoint, converging in ~O(log log n)
// getBlock calls (~4) vs binary search's ~24. each getBlock is cached, so this collapses
// the dominant RPC cost of timestamp->block resolution.
async function estimateHeightManual(chainId: number, timestamp: bigint) {
  const top = await getBlock(chainId)
  let hi = top.number, hiTime = top.timestamp
  if (timestamp >= hiTime) return hi

  // Do not hard-require block 1: pruned archives and some chains throw
  // BlockNotFoundError there (~800/h on ingest-v-2). Prefer genesis (0), then 1,
  // then the earliest height the RPC can actually serve.
  const { number: lo, timestamp: loTime } = await earliestReachableBlock(chainId, hi)
  if (timestamp <= loTime) return lo

  let loBlock = lo, loBlockTime = loTime
  while (hi - loBlock > 1n) {
    let probe = hiTime > loBlockTime
      ? loBlock + ((hi - loBlock) * (timestamp - loBlockTime)) / (hiTime - loBlockTime)
      : (loBlock + hi) / 2n
    if (probe <= loBlock) probe = loBlock + 1n
    else if (probe >= hi) probe = hi - 1n
    const block = await getBlock(chainId, probe)
    if (block.timestamp < timestamp) { loBlock = probe; loBlockTime = block.timestamp }
    else { hi = probe; hiTime = block.timestamp }
  }

  return hi
}

/** Lowest block number this RPC can serve, used as the estimateHeight low bound. */
async function earliestReachableBlock(chainId: number, hi: bigint): Promise<Block> {
  const result = cache.wrap(`earliestReachableBlock:${chainId}`, async () => {
    return await findEarliestReachableBlock(chainId, hi)
  }, HISTORICAL_BLOCK_TTL)
  return BlockSchema.parse(await result)
}

async function findEarliestReachableBlock(chainId: number, hi: bigint): Promise<Block> {
  // Missing genesis / block 1 is expected on pruned archives (~800/h BlockNotFound
  // when estimateHeight required lo=1). Swallow those two probes; cache the frontier
  // so later estimates never hit 0/1 again.
  for (const candidate of [0n, 1n]) {
    try {
      return await getBlock(chainId, candidate)
    } catch {
      // pruned or missing
    }
  }

  // Exponential walk back from tip until a miss, then binary-search the frontier.
  let ok = hi
  let miss = 0n
  for (let delta = 1n; delta < hi; delta *= 2n) {
    const probe = hi - delta
    try {
      await getBlock(chainId, probe)
      ok = probe
    } catch {
      miss = probe
      break
    }
  }

  while (ok - miss > 1n) {
    const mid = miss + (ok - miss) / 2n
    try {
      await getBlock(chainId, mid)
      ok = mid
    } catch {
      miss = mid
    }
  }

  return await getBlock(chainId, ok)
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
