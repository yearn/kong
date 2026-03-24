import 'lib/global'

import { computeApy, computeNetApr } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { upsertBatchOutput } from 'ingest/load'
import { math, mq } from 'lib'
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
type FeeConfigBps = { management: number; performance: number }
type FeeSegment = { blockNumber: bigint } & FeeConfigBps
type AccountantSegment = { blockNumber: bigint; accountant: `0x${string}` }

type StrategyChangeEvent = { blockNumber: bigint; strategy: `0x${string}`; type: 'add' | 'revoke' }
type DebtSnapshot = { blockNumber: bigint; currentDebt: bigint }

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
const UPDATE_ACCOUNTANT_SELECTOR = toEventSelector(
  'event UpdateAccountant(address indexed accountant)'
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

/** Build vault accountant timelines from UpdateAccountant events, with snapshot fallback when no history exists */
async function buildVaultAccountantTimelines(
  candidates: TimeseriesCandidate[]
): Promise<Map<string, AccountantSegment[]>> {
  const byChain = new Map<number, Set<string>>()
  for (const c of candidates) {
    if (!byChain.has(c.chainId)) byChain.set(c.chainId, new Set())
    byChain.get(c.chainId)!.add(c.address)
  }

  const timelines = new Map<string, AccountantSegment[]>()

  for (const [chainId, addresses] of byChain) {
    const vaults = [...addresses]
    const history = await db.query(`
      SELECT chain_id, address, block_number, args
      FROM evmlog
      WHERE chain_id = $1 AND address = ANY($2) AND signature = $3
      ORDER BY block_number ASC, log_index ASC
    `, [chainId, vaults, UPDATE_ACCOUNTANT_SELECTOR])

    for (const row of history.rows) {
      const accountant = row.args.accountant ? getAddress(row.args.accountant) as `0x${string}` : zeroAddress
      if (accountant === zeroAddress) continue
      const key = `${row.chain_id}:${row.address}`
      if (!timelines.has(key)) timelines.set(key, [])
      timelines.get(key)!.push({
        blockNumber: BigInt(row.block_number),
        accountant,
      })
    }

    const result = await db.query(`
      SELECT address, snapshot->>'accountant' AS accountant
      FROM snapshot
      WHERE chain_id = $1 AND address = ANY($2)
        AND snapshot->>'accountant' IS NOT NULL
    `, [chainId, vaults])

    for (const row of result.rows) {
      const accountant = row.accountant ? getAddress(row.accountant) as `0x${string}` : zeroAddress
      if (accountant !== zeroAddress) {
        const key = `${chainId}:${row.address}`
        if (!timelines.has(key) || timelines.get(key)!.length === 0) {
          timelines.set(key, [{ blockNumber: 0n, accountant }])
        }
      }
    }
  }

  return timelines
}

function lookupAccountantAtBlock(
  timeline: AccountantSegment[] | undefined,
  blockNumber: bigint
): `0x${string}` | undefined {
  if (!timeline || timeline.length === 0) return undefined
  let accountant: `0x${string}` | undefined
  for (const segment of timeline) {
    if (segment.blockNumber <= blockNumber) {
      accountant = segment.accountant
    } else {
      break
    }
  }
  return accountant
}

/** Build default fee timelines from UpdateDefaultFeeConfig events in evmlog */
async function buildDefaultFeeTimelines(
  vaultAccountants: Map<string, AccountantSegment[]>
): Promise<Map<string, FeeSegment[]>> {
  const accountantsByChain = new Map<number, Set<string>>()
  for (const [key, timeline] of vaultAccountants) {
    const chainId = Number(key.split(':')[0])
    if (!accountantsByChain.has(chainId)) accountantsByChain.set(chainId, new Set())
    for (const { accountant } of timeline) {
      accountantsByChain.get(chainId)!.add(accountant)
    }
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
        management: Number(cfg.managementFee ?? cfg[0] ?? 0),
        performance: Number(cfg.performanceFee ?? cfg[1] ?? 0),
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
  vaultAccountants: Map<string, AccountantSegment[]>
): Promise<Map<string, CustomFeeEvent[]>> {
  const accountantsByChain = new Map<number, Set<string>>()
  for (const [key, timeline] of vaultAccountants) {
    const chainId = Number(key.split(':')[0])
    if (!accountantsByChain.has(chainId)) accountantsByChain.set(chainId, new Set())
    for (const { accountant } of timeline) {
      accountantsByChain.get(chainId)!.add(accountant)
    }
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
          management: Number(cfg.managementFee ?? cfg[0] ?? 0),
          performance: Number(cfg.performanceFee ?? cfg[1] ?? 0),
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

/** Find the fee config (BPS) active at a given block from a sorted timeline */
function lookupDefaultAtBlock(timeline: FeeSegment[] | undefined, blockNumber: bigint): FeeConfigBps {
  if (!timeline || timeline.length === 0) return { management: 0, performance: 0 }
  let result: FeeConfigBps = { management: 0, performance: 0 }
  for (const segment of timeline) {
    if (segment.blockNumber <= blockNumber) {
      result = { management: segment.management, performance: segment.performance }
    } else {
      break
    }
  }
  return result
}

/** Find the custom fee config (BPS) active at a given block, or null if reverted to default */
function lookupCustomAtBlock(timeline: CustomFeeEvent[] | undefined, blockNumber: bigint): FeeConfigBps | null {
  if (!timeline || timeline.length === 0) return null
  let result: FeeConfigBps | null = null
  for (const event of timeline) {
    if (event.blockNumber <= blockNumber) {
      result = event.type === 'set' ? { management: event.management, performance: event.performance } : null
    } else {
      break
    }
  }
  return result
}

/** Build strategy change timelines from StrategyChanged events per vault */
const STRATEGY_CHANGED_SELECTOR = toEventSelector(
  'event StrategyChanged(address indexed strategy, uint256 change_type)'
)

async function buildStrategyTimelines(
  candidates: TimeseriesCandidate[]
): Promise<Map<string, StrategyChangeEvent[]>> {
  const byChain = new Map<number, Set<string>>()
  for (const c of candidates) {
    if (!byChain.has(c.chainId)) byChain.set(c.chainId, new Set())
    byChain.get(c.chainId)!.add(c.address)
  }

  const timelines = new Map<string, StrategyChangeEvent[]>()

  for (const [chainId, addresses] of byChain) {
    const result = await db.query(`
      SELECT chain_id, address, block_number, args
      FROM evmlog
      WHERE chain_id = $1 AND address = ANY($2) AND signature = $3
      ORDER BY block_number ASC, log_index ASC
    `, [chainId, [...addresses], STRATEGY_CHANGED_SELECTOR])

    for (const row of result.rows) {
      const key = `${row.chain_id}:${row.address}`
      if (!timelines.has(key)) timelines.set(key, [])
      const changeType: Record<number, 'add' | 'revoke'> = { [2 ** 0]: 'add', [2 ** 1]: 'revoke' }
      const type = changeType[Number(row.args.change_type)]
      if (type) {
        timelines.get(key)!.push({
          blockNumber: BigInt(row.block_number),
          strategy: getAddress(row.args.strategy) as `0x${string}`,
          type,
        })
      }
    }
  }

  return timelines
}

/** Project strategy set at a given block by replaying StrategyChanged events */
function projectStrategiesAtBlock(
  timeline: StrategyChangeEvent[] | undefined,
  blockNumber: bigint
): `0x${string}`[] {
  if (!timeline) return []
  const strategies: `0x${string}`[] = []
  for (const event of timeline) {
    if (event.blockNumber > blockNumber) break
    if (event.type === 'add') {
      if (!strategies.includes(event.strategy)) strategies.push(event.strategy)
    } else {
      const idx = strategies.indexOf(event.strategy)
      if (idx >= 0) strategies.splice(idx, 1)
    }
  }
  return strategies
}

/** Build debt timelines from debt-changing events per (vault, strategy) */
const STRATEGY_REPORTED_SELECTOR = toEventSelector(
  'event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 current_debt, uint256 protocol_fees, uint256 total_fees, uint256 total_refunds)'
)
const DEBT_UPDATED_SELECTOR = toEventSelector(
  'event DebtUpdated(address indexed strategy, uint256 current_debt, uint256 new_debt)'
)

async function buildDebtTimelines(
  candidates: TimeseriesCandidate[]
): Promise<Map<string, DebtSnapshot[]>> {
  const byChain = new Map<number, Set<string>>()
  for (const c of candidates) {
    if (!byChain.has(c.chainId)) byChain.set(c.chainId, new Set())
    byChain.get(c.chainId)!.add(c.address)
  }

  const timelines = new Map<string, DebtSnapshot[]>()

  for (const [chainId, addresses] of byChain) {
    const result = await db.query(`
      SELECT chain_id, address, block_number, log_index, signature, args
      FROM evmlog
      WHERE chain_id = $1 AND address = ANY($2) AND signature = ANY($3)
      ORDER BY block_number ASC, log_index ASC
    `, [chainId, [...addresses], [STRATEGY_REPORTED_SELECTOR, DEBT_UPDATED_SELECTOR]])

    for (const row of result.rows) {
      const strategy = getAddress(row.args.strategy) as `0x${string}`
      const key = `${row.chain_id}:${row.address}:${strategy}`
      if (!timelines.has(key)) timelines.set(key, [])
      const currentDebt = row.signature === DEBT_UPDATED_SELECTOR
        ? BigInt(row.args.new_debt)
        : BigInt(row.args.current_debt)
      timelines.get(key)!.push({
        blockNumber: BigInt(row.block_number),
        currentDebt,
      })
    }
  }

  return timelines
}

/** Lookup the latest debt snapshot for a strategy at or before blockNumber */
function lookupDebtAtBlock(timeline: DebtSnapshot[] | undefined, blockNumber: bigint): bigint {
  if (!timeline || timeline.length === 0) return 0n
  let result = 0n
  for (const snapshot of timeline) {
    if (snapshot.blockNumber <= blockNumber) {
      result = snapshot.currentDebt
    } else {
      break
    }
  }
  return result
}

/** Resolve fees for a vault at a given block using debt-weighted BPS averaging (matches production extractFees__v3) */
function resolveFees(
  chainId: number,
  vault: `0x${string}`,
  accountant: `0x${string}`,
  strategies: `0x${string}`[],
  blockNumber: bigint,
  defaultTimelines: Map<string, FeeSegment[]>,
  customTimelines: Map<string, CustomFeeEvent[]>,
  debtTimelines: Map<string, DebtSnapshot[]>,
): FeeConfig {
  const accountantKey = `${chainId}:${accountant}`
  const defaultFeesBps = lookupDefaultAtBlock(defaultTimelines.get(accountantKey), blockNumber)

  if (strategies.length === 0) {
    return {
      management: defaultFeesBps.management / 10_000,
      performance: defaultFeesBps.performance / 10_000,
    }
  }

  // Compute debt-weighted fees in BPS (matching production extractFees__v3)
  const debts: bigint[] = strategies.map(strategy => {
    const debtKey = `${chainId}:${vault}:${strategy}`
    return lookupDebtAtBlock(debtTimelines.get(debtKey), blockNumber)
  })
  const totalDebt = debts.reduce((a, b) => a + b, 0n)

  // If no debt data, fall back to equal weighting
  if (totalDebt === 0n) {
    let totalManagement = 0
    let totalPerformance = 0
    for (const strategy of strategies) {
      const customKey = `${chainId}:${vault}:${strategy}`
      const custom = lookupCustomAtBlock(customTimelines.get(customKey), blockNumber)
      if (custom) {
        totalManagement += custom.management
        totalPerformance += custom.performance
      } else {
        totalManagement += defaultFeesBps.management
        totalPerformance += defaultFeesBps.performance
      }
    }
    return {
      management: (totalManagement / strategies.length) / 10_000,
      performance: (totalPerformance / strategies.length) / 10_000,
    }
  }

  const feesBps = { management: 0, performance: 0 }
  for (let i = 0; i < strategies.length; i++) {
    const debtRatio = math.div(debts[i], totalDebt)
    if (Number.isNaN(debtRatio)) continue
    const customKey = `${chainId}:${vault}:${strategies[i]}`
    const custom = lookupCustomAtBlock(customTimelines.get(customKey), blockNumber)
    if (custom) {
      feesBps.management += debtRatio * custom.management
      feesBps.performance += debtRatio * custom.performance
    } else {
      feesBps.management += debtRatio * defaultFeesBps.management
      feesBps.performance += debtRatio * defaultFeesBps.performance
    }
  }

  return {
    management: feesBps.management / 10_000,
    performance: feesBps.performance / 10_000,
  }
}

async function buildCaches(candidates: TimeseriesCandidate[]): Promise<{
  vaultAccountantTimelines: Map<string, AccountantSegment[]>
  defaultTimelines: Map<string, FeeSegment[]>
  customTimelines: Map<string, CustomFeeEvent[]>
  strategyTimelines: Map<string, StrategyChangeEvent[]>
  debtTimelines: Map<string, DebtSnapshot[]>
}> {
  const vaultAccountantTimelines = await buildVaultAccountantTimelines(candidates)
  console.log(`found accountant timelines for ${vaultAccountantTimelines.size} vaults`)

  const [defaultTimelines, customTimelines, strategyTimelines, debtTimelines] = await Promise.all([
    buildDefaultFeeTimelines(vaultAccountantTimelines),
    buildCustomFeeTimelines(vaultAccountantTimelines),
    buildStrategyTimelines(candidates),
    buildDebtTimelines(candidates),
  ])

  const totalDefaultEvents = [...defaultTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  const totalCustomEvents = [...customTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  const totalStrategyEvents = [...strategyTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  const totalDebtEvents = [...debtTimelines.values()].reduce((sum, t) => sum + t.length, 0)
  console.log(`loaded ${totalDefaultEvents} default fee events, ${totalCustomEvents} custom fee events, ${totalStrategyEvents} strategy events, ${totalDebtEvents} debt events from evmlog`)

  return { vaultAccountantTimelines, defaultTimelines, customTimelines, strategyTimelines, debtTimelines }
}

async function backfillTimeseries(args: Args) {
  const candidates = await getTimeseriesCandidates(args)
  console.log(`timeseries candidates: ${candidates.length}`)
  if (candidates.length === 0) return

  const { vaultAccountantTimelines, defaultTimelines, customTimelines, strategyTimelines, debtTimelines } = await buildCaches(candidates)

  const outputs: Output[] = []
  let noAccountant = 0

  for (const candidate of candidates) {
    const vaultKey = `${candidate.chainId}:${candidate.address}`
    const accountant = lookupAccountantAtBlock(vaultAccountantTimelines.get(vaultKey), candidate.blockNumber)

    let fees: FeeConfig
    if (!accountant) {
      fees = { management: 0, performance: 0 }
      noAccountant++
    } else {
      // Project strategies at this candidate's block (not latest)
      const strategies = projectStrategiesAtBlock(strategyTimelines.get(vaultKey), candidate.blockNumber)
      fees = resolveFees(
        candidate.chainId, candidate.address, accountant, strategies,
        candidate.blockNumber, defaultTimelines, customTimelines, debtTimelines,
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
