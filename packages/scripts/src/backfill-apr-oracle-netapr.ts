import 'lib/global'

import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { computeApy, computeNetApr } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { upsertBatchOutput } from 'ingest/load'
import { mq } from 'lib'
import type { Output } from 'lib/types'
import { getAddress, toEventSelector, zeroAddress } from 'viem'

type Args = {
  apply: boolean
  chainId?: number
  address?: `0x${string}`
}

type TimeseriesCandidate = {
  chainId: number
  address: `0x${string}`
  blockNumber: bigint
  blockTime: bigint
  apr: number
  hasNetApr: boolean
  hasNetApy: boolean
}

type FeeConfig = { management: number; performance: number }
type FeeSegment = { blockNumber: bigint } & FeeConfig

const WRITE_BATCH_SIZE = 1000
const WRITE_CONCURRENCY = 10

const DEFAULT_FEE_SELECTOR = toEventSelector(
  'event UpdateDefaultFeeConfig((uint16,uint16,uint16,uint16,uint16,uint16) defaultFeeConfig)'
)
const CUSTOM_FEE_SELECTOR = toEventSelector(
  'event UpdateCustomFeeConfig(address indexed vault, address indexed strategy, (uint16,uint16,uint16,uint16,uint16,uint16) custom_config)'
)
const REMOVED_CUSTOM_FEE_SELECTOR = toEventSelector(
  'event RemovedCustomFeeConfig(address indexed vault, address indexed strategy)'
)

function parseArgs(argv: string[]): Args {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-netapr.ts [--apply] [--chain-id 1] [--address 0x...]

defaults:
  dry-run unless --apply is provided`)
    process.exit(0)
  }

  const chainId = getArg('--chain-id')
  const address = getArg('--address')

  return {
    apply: hasArg('--apply'),
    chainId: chainId ? Number(chainId) : undefined,
    address: address ? getAddress(address as `0x${string}`) : undefined,
  }
}

async function getTimeseriesCandidates(args: Args): Promise<TimeseriesCandidate[]> {
  const values: Array<number | string> = []
  const filters: string[] = []

  if (args.chainId !== undefined) {
    values.push(args.chainId)
    filters.push(`o.chain_id = $${values.length}`)
  }

  if (args.address) {
    values.push(args.address)
    filters.push(`o.address = $${values.length}`)
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

  const result = await db.query(`
    WITH grouped AS (
      SELECT
        o.chain_id AS "chainId",
        o.address,
        MAX(o.block_number) AS "blockNumber",
        EXTRACT(EPOCH FROM MAX(o.block_time))::bigint AS "blockTime",
        MAX(CASE WHEN o.component = 'apr' THEN o.value END) AS apr,
        BOOL_OR(o.component = 'netApr') AS "hasNetApr",
        BOOL_OR(o.component = 'netApy') AS "hasNetApy"
      FROM output o
      JOIN thing t
        ON t.chain_id = o.chain_id
        AND t.address = o.address
        AND t.label = 'vault'
        AND COALESCE((t.defaults->>'v3')::boolean, false)
      WHERE o.label = 'apr-oracle'
        AND o.component IN ('apr', 'netApr', 'netApy')
        ${whereClause}
      GROUP BY o.chain_id, o.address, o.series_time
    )
    SELECT *
    FROM grouped
    WHERE apr IS NOT NULL
      AND (NOT "hasNetApr" OR NOT "hasNetApy")
    ORDER BY "chainId", address, "blockNumber"
  `, values)

  return result.rows.map(row => ({
    chainId: row.chainId,
    address: row.address,
    blockNumber: BigInt(row.blockNumber),
    blockTime: BigInt(row.blockTime),
    apr: Number(row.apr),
    hasNetApr: Boolean(row.hasNetApr),
    hasNetApy: Boolean(row.hasNetApy),
  }))
}

/** Get vault→accountant mapping from snapshot table */
async function getVaultAccountants(candidates: TimeseriesCandidate[]): Promise<Map<string, `0x${string}`>> {
  const byChain = new Map<number, Set<string>>()
  for (const c of candidates) {
    if (!byChain.has(c.chainId)) byChain.set(c.chainId, new Set())
    byChain.get(c.chainId)!.add(c.address)
  }

  const vaultAccountants = new Map<string, `0x${string}`>()

  for (const [chainId, addresses] of byChain) {
    const result = await db.query(`
      SELECT address, snapshot->>'accountant' AS accountant
      FROM snapshot
      WHERE chain_id = $1 AND address = ANY($2)
        AND snapshot->>'accountant' IS NOT NULL
    `, [chainId, [...addresses]])

    for (const row of result.rows) {
      if (row.accountant && row.accountant !== zeroAddress) {
        vaultAccountants.set(`${chainId}:${row.address}`, row.accountant)
      }
    }
  }

  return vaultAccountants
}

/** Build default fee timelines from UpdateDefaultFeeConfig events in evmlog */
async function buildDefaultFeeTimelines(
  vaultAccountants: Map<string, `0x${string}`>
): Promise<Map<string, FeeSegment[]>> {
  const accountantsByChain = new Map<number, Set<string>>()
  for (const [key, accountant] of vaultAccountants) {
    const chainId = Number(key.split(':')[0])
    if (!accountantsByChain.has(chainId)) accountantsByChain.set(chainId, new Set())
    accountantsByChain.get(chainId)!.add(accountant)
  }

  const timelines = new Map<string, FeeSegment[]>()

  for (const [chainId, accountants] of accountantsByChain) {
    const result = await db.query(`
      SELECT chain_id, address, block_number, args
      FROM evmlog
      WHERE chain_id = $1 AND address = ANY($2) AND signature = $3
      ORDER BY block_number ASC, log_index ASC
    `, [chainId, [...accountants], DEFAULT_FEE_SELECTOR])

    for (const row of result.rows) {
      const key = `${row.chain_id}:${row.address}`
      if (!timelines.has(key)) timelines.set(key, [])
      const cfg = row.args.defaultFeeConfig ?? row.args
      timelines.get(key)!.push({
        blockNumber: BigInt(row.block_number),
        management: Number(cfg.managementFee ?? cfg[0] ?? 0) / 10_000,
        performance: Number(cfg.performanceFee ?? cfg[1] ?? 0) / 10_000,
      })
    }
  }

  return timelines
}

type CustomFeeEvent = {
  blockNumber: bigint
  type: 'set' | 'removed'
  management: number
  performance: number
}

/** Build custom fee timelines from UpdateCustomFeeConfig and RemovedCustomFeeConfig events */
async function buildCustomFeeTimelines(
  vaultAccountants: Map<string, `0x${string}`>
): Promise<Map<string, CustomFeeEvent[]>> {
  const accountantsByChain = new Map<number, Set<string>>()
  for (const [key, accountant] of vaultAccountants) {
    const chainId = Number(key.split(':')[0])
    if (!accountantsByChain.has(chainId)) accountantsByChain.set(chainId, new Set())
    accountantsByChain.get(chainId)!.add(accountant)
  }

  const timelines = new Map<string, CustomFeeEvent[]>()

  for (const [chainId, accountants] of accountantsByChain) {
    // Query both custom config set and removed events
    const result = await db.query(`
      SELECT chain_id, address, block_number, log_index, signature, args
      FROM evmlog
      WHERE chain_id = $1 AND address = ANY($2) AND signature = ANY($3)
      ORDER BY block_number ASC, log_index ASC
    `, [chainId, [...accountants], [CUSTOM_FEE_SELECTOR, REMOVED_CUSTOM_FEE_SELECTOR]])

    for (const row of result.rows) {
      const vault = row.args.vault as string
      const strategy = row.args.strategy as string
      const key = `${row.chain_id}:${vault}:${strategy}`
      if (!timelines.has(key)) timelines.set(key, [])

      if (row.signature === CUSTOM_FEE_SELECTOR) {
        const cfg = row.args.custom_config ?? row.args
        timelines.get(key)!.push({
          blockNumber: BigInt(row.block_number),
          type: 'set',
          management: Number(cfg.managementFee ?? cfg[0] ?? 0) / 10_000,
          performance: Number(cfg.performanceFee ?? cfg[1] ?? 0) / 10_000,
        })
      } else {
        timelines.get(key)!.push({
          blockNumber: BigInt(row.block_number),
          type: 'removed',
          management: 0,
          performance: 0,
        })
      }
    }
  }

  return timelines
}

/** Find the fee config active at a given block from a sorted timeline */
function lookupDefaultAtBlock(timeline: FeeSegment[] | undefined, blockNumber: bigint): FeeConfig {
  if (!timeline || timeline.length === 0) return { management: 0, performance: 0 }
  let result: FeeConfig = { management: 0, performance: 0 }
  for (const segment of timeline) {
    if (segment.blockNumber <= blockNumber) {
      result = { management: segment.management, performance: segment.performance }
    } else {
      break
    }
  }
  return result
}

/** Find the custom fee config active at a given block, or null if reverted to default */
function lookupCustomAtBlock(timeline: CustomFeeEvent[] | undefined, blockNumber: bigint): FeeConfig | null {
  if (!timeline || timeline.length === 0) return null
  let result: FeeConfig | null = null
  for (const event of timeline) {
    if (event.blockNumber <= blockNumber) {
      result = event.type === 'set' ? { management: event.management, performance: event.performance } : null
    } else {
      break
    }
  }
  return result
}

/** Resolve fees for a vault at a given block using evmlog-based fee timelines */
function resolveFees(
  chainId: number,
  vault: `0x${string}`,
  accountant: `0x${string}`,
  strategies: `0x${string}`[],
  blockNumber: bigint,
  defaultTimelines: Map<string, FeeSegment[]>,
  customTimelines: Map<string, CustomFeeEvent[]>,
): FeeConfig {
  const accountantKey = `${chainId}:${accountant}`
  const defaultFees = lookupDefaultAtBlock(defaultTimelines.get(accountantKey), blockNumber)

  if (strategies.length === 0) return defaultFees

  // Check if any strategy has a custom config at this block
  let totalManagement = 0
  let totalPerformance = 0
  for (const strategy of strategies) {
    const customKey = `${chainId}:${vault}:${strategy}`
    const custom = lookupCustomAtBlock(customTimelines.get(customKey), blockNumber)
    if (custom) {
      totalManagement += custom.management
      totalPerformance += custom.performance
    } else {
      totalManagement += defaultFees.management
      totalPerformance += defaultFees.performance
    }
  }

  // Equal-weighted average across strategies (approximation without on-chain debt data)
  return {
    management: totalManagement / strategies.length,
    performance: totalPerformance / strategies.length,
  }
}

async function buildFeeCache(candidates: TimeseriesCandidate[]): Promise<{
  vaultAccountants: Map<string, `0x${string}`>
  defaultTimelines: Map<string, FeeSegment[]>
  customTimelines: Map<string, CustomFeeEvent[]>
}> {
  const vaultAccountants = await getVaultAccountants(candidates)
  console.log(`found accountants for ${vaultAccountants.size} vaults`)

  const [defaultTimelines, customTimelines] = await Promise.all([
    buildDefaultFeeTimelines(vaultAccountants),
    buildCustomFeeTimelines(vaultAccountants),
  ])

  const totalDefaultEvents = [...defaultTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  const totalCustomEvents = [...customTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  console.log(`loaded ${totalDefaultEvents} default fee events, ${totalCustomEvents} custom fee events from evmlog`)

  return { vaultAccountants, defaultTimelines, customTimelines }
}

async function backfillTimeseries(args: Args) {
  const candidates = await getTimeseriesCandidates(args)
  console.log(`timeseries candidates: ${candidates.length}`)
  if (candidates.length === 0) return

  const { vaultAccountants, defaultTimelines, customTimelines } = await buildFeeCache(candidates)

  // Cache strategies per vault to avoid repeated DB queries
  const strategyCache = new Map<string, `0x${string}`[]>()

  // Group candidates by vault for strategy caching
  const vaultCandidates = new Map<string, TimeseriesCandidate[]>()
  for (const c of candidates) {
    const key = `${c.chainId}:${c.address}`
    if (!vaultCandidates.has(key)) vaultCandidates.set(key, [])
    vaultCandidates.get(key)!.push(c)
  }

  // Pre-fetch strategies for each vault at each unique block
  // (projectStrategies is a DB query, not RPC)
  const STRATEGY_CONCURRENCY = 10
  const vaultEntries = [...vaultCandidates.entries()]
  for (let i = 0; i < vaultEntries.length; i += STRATEGY_CONCURRENCY) {
    const batch = vaultEntries.slice(i, i + STRATEGY_CONCURRENCY)
    await Promise.all(batch.map(async ([key, vCandidates]) => {
      const { chainId, address } = vCandidates[0]
      // Use the latest blockNumber for strategy projection
      const maxBlock = vCandidates.reduce((max, c) => c.blockNumber > max ? c.blockNumber : max, 0n)
      const strategies = await projectStrategies(chainId, address, maxBlock)
      strategyCache.set(key, strategies)
    }))
    if ((i + STRATEGY_CONCURRENCY) % 200 === 0 || i + STRATEGY_CONCURRENCY >= vaultEntries.length) {
      console.log(`fetched strategies ${Math.min(i + STRATEGY_CONCURRENCY, vaultEntries.length)}/${vaultEntries.length}`)
    }
  }

  const outputs: Output[] = []
  let noAccountant = 0

  for (const candidate of candidates) {
    const vaultKey = `${candidate.chainId}:${candidate.address}`
    const accountant = vaultAccountants.get(vaultKey)

    let fees: FeeConfig
    if (!accountant) {
      fees = { management: 0, performance: 0 }
      noAccountant++
    } else {
      const strategies = strategyCache.get(vaultKey) ?? []
      fees = resolveFees(
        candidate.chainId, candidate.address, accountant, strategies,
        candidate.blockNumber, defaultTimelines, customTimelines,
      )
    }

    const netApr = computeNetApr(candidate.apr, fees)
    const netApy = computeApy(netApr)

    if (!candidate.hasNetApr) {
      outputs.push({
        chainId: candidate.chainId,
        address: candidate.address,
        label: 'apr-oracle',
        component: 'netApr',
        value: netApr,
        blockNumber: candidate.blockNumber,
        blockTime: candidate.blockTime,
      })
    }

    if (!candidate.hasNetApy) {
      outputs.push({
        chainId: candidate.chainId,
        address: candidate.address,
        label: 'apr-oracle',
        component: 'netApy',
        value: netApy,
        blockNumber: candidate.blockNumber,
        blockTime: candidate.blockTime,
      })
    }
  }

  if (noAccountant > 0) {
    console.warn(`${noAccountant} candidates had no accountant, used zero fees`)
  }

  console.log(`computed ${outputs.length} outputs, writing...`)

  const batches: Output[][] = []
  for (let i = 0; i < outputs.length; i += WRITE_BATCH_SIZE) {
    batches.push(outputs.slice(i, i + WRITE_BATCH_SIZE))
  }

  let written = 0
  for (let i = 0; i < batches.length; i += WRITE_CONCURRENCY) {
    const chunk = batches.slice(i, i + WRITE_CONCURRENCY)
    if (args.apply) {
      await Promise.all(chunk.map(batch => upsertBatchOutput(batch)))
    }
    written += chunk.reduce((sum, b) => sum + b.length, 0)
    console.log(`written ${written}/${outputs.length} outputs`)
  }

  console.log(`${args.apply ? 'upserted' : 'prepared (dry-run)'}: ${outputs.length} timeseries outputs`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(args.apply ? 'apply mode' : 'dry-run mode')
  if (args.chainId !== undefined) console.log(`chainId=${args.chainId}`)
  if (args.address) console.log(`address=${args.address}`)

  try {
    await backfillTimeseries(args)
  } finally {
    await mq.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('backfill-apr-oracle-netapr', error)
  process.exit(1)
})
