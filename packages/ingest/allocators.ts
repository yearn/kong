import { createHash } from 'node:crypto'
import { getAddress, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem'
import { z } from 'zod'
import { blockEndPosition, resolveAllocatorAssignment } from 'lib/allocators'
import type { AllocationSourceEvent, AllocatorDeploymentEvidence, AllocatorResolution } from 'lib/allocator-types'

const CHAINS = [1, 8453, 747474]
const PAGE_SIZE = 1000
const MAX_EVENTS = 50_000
const AddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(value => value.toLowerCase() as Address)
const PositionSchema = z.object({
  id: z.string().min(1), blockNumber: z.coerce.number().int().nonnegative(),
  transactionIndex: z.number().int().nonnegative(), logIndex: z.number().int().nonnegative()
})
const EventSchema = PositionSchema.extend({
  chainId: z.number().int(), vaultAddress: AddressSchema, sourceAddress: AddressSchema,
  blockHash: z.string().regex(/^0x[\da-fA-F]{64}$/), normalizationVersion: z.number().int().min(3),
  eventName: z.enum(['AddedNewVault', 'UpdateDebtAllocator', 'RemovedVault', 'UpdateRoleManager']), argsJson: z.string()
})
const SHARED_FACTORY = '0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18'
const BOUND_FACTORY = '0xfcf8c7c43dedd567083b422d6770f23b78d15bde'

export interface AllocatorRatio {
  targetDebtRatio: number | null
  maxDebtRatio: number | null
}

export interface CurrentAllocatorProjection extends AllocatorResolution {
  schemaVersion: 1
  chainId: number
  vault: Address
  revision: string | null
  sourceRevision: string | null
  blockHash: string | null
  observedAt: string
  ratios: Record<string, AllocatorRatio>
  evidence: { events: AllocationSourceEvent[]; deployments: AllocatorDeploymentEvidence[] }
}

type Rpc = Pick<PublicClient, 'getBlock' | 'readContract' | 'getBytecode' | 'multicall'>

async function query<T>(document: string, variables: Record<string, unknown>): Promise<T> {
  const url = process.env.ENVIO_ALLOCATION_GRAPHQL_URL?.trim()
  if (!url) throw new Error('envio_not_configured')
  const token = process.env.ENVIO_ALLOCATION_GRAPHQL_TOKEN?.trim()
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error('envio_request_failed')
  const body = await response.json() as { data?: T; errors?: unknown[] }
  if (!body.data || body.errors?.length) throw new Error('envio_evidence_unavailable')
  return body.data
}

async function assignments(chainId: number, vault: Address, toBlock: number): Promise<z.infer<typeof EventSchema>[]> {
  const collected: z.infer<typeof EventSchema>[] = []
  let cursor: z.infer<typeof PositionSchema> | undefined
  while (true) {
    const data = await query<{ items: unknown[] }>(`query AllocatorAssignments(
      $chainId: Int! $vault: String! $toBlock: Int! $limit: Int!
      ${cursor ? '$block: Int! $transaction: Int! $log: Int! $id: String!' : ''}
    ) { items: AllocationSourceEvent(where: {
      chainId: {_eq: $chainId} vaultAddress: {_eq: $vault} scope: {_eq: "vault"}
      blockNumber: {_lte: $toBlock}
      eventName: {_in: ["AddedNewVault", "UpdateDebtAllocator", "RemovedVault", "UpdateRoleManager"]}
      ${cursor ? `_or: [
        {blockNumber: {_gt: $block}}
        {blockNumber: {_eq: $block}, transactionIndex: {_gt: $transaction}}
        {blockNumber: {_eq: $block}, transactionIndex: {_eq: $transaction}, logIndex: {_gt: $log}}
        {blockNumber: {_eq: $block}, transactionIndex: {_eq: $transaction}, logIndex: {_eq: $log}, id: {_gt: $id}}
      ]` : ''}
    } order_by: [{blockNumber: asc}, {transactionIndex: asc}, {logIndex: asc}, {id: asc}] limit: $limit) {
      id chainId vaultAddress sourceAddress eventName argsJson normalizationVersion
      blockHash blockNumber transactionIndex logIndex
    } }`, { chainId, vault, toBlock, limit: PAGE_SIZE, ...(cursor ? {
      block: cursor.blockNumber, transaction: cursor.transactionIndex, log: cursor.logIndex, id: cursor.id
    } : {}) })
    const page = EventSchema.array().parse(data.items)
    if (page.some(row => row.chainId !== chainId || row.vaultAddress !== vault || row.blockNumber > toBlock)) throw new Error('envio_scope_mismatch')
    collected.push(...page)
    if (collected.length > MAX_EVENTS) throw new Error('allocator_event_limit')
    if (page.length < PAGE_SIZE) return collected
    const next = PositionSchema.parse(page[page.length - 1])
    if (cursor && JSON.stringify(cursor) === JSON.stringify(next)) throw new Error('allocator_cursor_stalled')
    cursor = next
  }
}

async function deployments(chainId: number, allocator: Address, toBlock: number): Promise<AllocatorDeploymentEvidence[]> {
  const data = await query<{ bound: unknown[]; shared: unknown[] }>(`query AllocatorDeployment($chainId: Int! $allocator: String! $toBlock: Int!) {
    bound: DebtAllocatorDeployment(where: {chainId: {_eq: $chainId}, allocatorAddress: {_eq: $allocator}, createdBlock: {_lte: $toBlock}}) {
      allocatorAddress vaultAddress factoryAddress abiVariant createdBlock createdEventId
    }
    shared: SharedDebtAllocatorDeployment(where: {chainId: {_eq: $chainId}, allocatorAddress: {_eq: $allocator}, createdBlock: {_lte: $toBlock}}) {
      allocatorAddress governanceAddress factoryAddress abiVariant createdBlock createdEventId
    }
  }`, { chainId, allocator, toBlock })
  const schema = z.object({ allocatorAddress: AddressSchema, factoryAddress: AddressSchema, abiVariant: z.string(),
    createdBlock: z.number().int().nonnegative(), createdEventId: z.string(), vaultAddress: AddressSchema.optional(), governanceAddress: AddressSchema.optional() })
  const result: AllocatorDeploymentEvidence[] = []
  for (const family of ['vault_bound', 'shared'] as const) {
    for (const row of schema.array().parse(family === 'shared' ? data.shared : data.bound)) {
      if (row.allocatorAddress !== allocator || row.createdBlock > toBlock ||
        row.factoryAddress !== (family === 'shared' ? SHARED_FACTORY : BOUND_FACTORY) ||
        (family === 'vault_bound' && chainId === 747474)) throw new Error('allocator_deployment_mismatch')
      result.push({ ...row, family, boundVaultAddress: row.vaultAddress ?? null,
        governanceAddress: row.governanceAddress ?? null, sourceEventId: row.createdEventId })
    }
  }
  if (result.length > 1) throw new Error('allocator_deployment_ambiguous')
  return result
}

export function allocatorRatioCalls(family: AllocatorResolution['family'], allocator: Address, vault: Address, strategy: Address) {
  if (family === 'unknown') return []
  const shared = family === 'shared'
  return ['getStrategyTargetRatio', 'getStrategyMaxRatio'].map(functionName => ({
    address: allocator, functionName,
    args: shared ? [vault, strategy] : [strategy],
    abi: parseAbi([`function ${functionName}(${shared ? 'address,address' : 'address'}) view returns (uint256)`])
  }))
}

export function ratioValue(result: { status: string; result?: unknown } | undefined): number | null {
  if (result?.status !== 'success' || typeof result.result !== 'bigint' || result.result < 0n || result.result > 10_000n) return null
  return Number(result.result)
}

export async function projectCurrentAllocator(chainId: number, vaultAddress: Address, strategies: Address[], rpc: Rpc): Promise<CurrentAllocatorProjection> {
  const vault = vaultAddress.toLowerCase() as Address
  const projection: CurrentAllocatorProjection = {
    schemaVersion: 1, chainId, vault, address: null, assignmentId: null, roleManagerAddress: null,
    status: 'unavailable', reason: 'assignment_evidence_unavailable', family: 'unknown', support: 'unavailable',
    asOfBlock: 0, deploymentSourceEventId: null, revision: null,
    sourceRevision: process.env.ENVIO_ALLOCATOR_SOURCE_REVISION?.trim() || null,
    blockHash: null, observedAt: new Date().toISOString(), ratios: {}, evidence: { events: [], deployments: [] }
  }
  if (!CHAINS.includes(chainId)) return { ...projection, reason: 'chain_not_configured' }
  if (!projection.sourceRevision) return { ...projection, reason: 'envio_source_revision_not_configured' }
  try {
    const [metadata, finalized] = await Promise.all([
      query<{ chain_metadata: unknown[] }>('query AllocatorHead { chain_metadata { chain_id start_block latest_processed_block } }', {}),
      rpc.getBlock({ blockTag: 'finalized' })
    ])
    const chain = z.object({ chain_id: z.number(), start_block: z.coerce.number().int(), latest_processed_block: z.coerce.number().int().nonnegative() })
      .array().parse(metadata.chain_metadata).find(row => row.chain_id === chainId)
    if (!chain || chain.start_block !== 0 || finalized.number === null) throw new Error('allocator_discovery_range_unavailable')
    const blockNumber = BigInt(Math.min(chain.latest_processed_block, Number(finalized.number)))
    const block = await rpc.getBlock({ blockNumber })
    if (!block.hash) throw new Error('allocator_block_unavailable')
    projection.asOfBlock = Number(blockNumber)
    projection.blockHash = block.hash
    const [rows, roleManager] = await Promise.all([
      assignments(chainId, vault, Number(blockNumber)),
      rpc.readContract({ address: vault, abi: parseAbi(['function role_manager() view returns (address)']), functionName: 'role_manager', blockNumber })
    ])
    const manager = AddressSchema.parse(roleManager)
    projection.roleManagerAddress = manager
    projection.evidence.events = rows.map(row => ({ ...row, args: z.record(z.unknown()).parse(JSON.parse(row.argsJson)) }))
    const resolved = resolveAllocatorAssignment({ vaultAddress: vault, events: projection.evidence.events,
      at: blockEndPosition(Number(blockNumber)), roleManagerAddress: manager })
    if (resolved.roleManagerAddress !== manager) throw new Error('role_manager_evidence_mismatch')
    if (resolved.status === 'unavailable' && resolved.reason !== 'vault_removed_from_role_manager') return { ...projection, ...resolved }
    const observed = AddressSchema.parse(await rpc.readContract({ address: manager,
      abi: parseAbi(['function getDebtAllocator(address) view returns (address)']), functionName: 'getDebtAllocator', args: [vault], blockNumber }))
    if (observed !== (resolved.address ?? zeroAddress)) throw new Error('allocator_assignment_mismatch')
    const assignedRow = rows.find(row => row.id === resolved.assignmentId)
    if (!assignedRow || (await rpc.getBlock({ blockNumber: BigInt(assignedRow.blockNumber) })).hash?.toLowerCase() !== assignedRow.blockHash.toLowerCase()) throw new Error('allocator_assignment_block_mismatch')
    Object.assign(projection, resolved)
  } catch {
    // Required assignment evidence failed. Do not substitute a factory address or an old assignment.
    return { ...projection, address: null, assignmentId: null, status: 'unavailable', reason: 'assignment_evidence_unavailable', support: 'unavailable' }
  }
  if (projection.address) {
    try {
      projection.evidence.deployments = await deployments(chainId, projection.address, projection.asOfBlock)
      Object.assign(projection, resolveAllocatorAssignment({ vaultAddress: vault, events: projection.evidence.events,
        at: blockEndPosition(projection.asOfBlock), roleManagerAddress: projection.roleManagerAddress,
        deployments: projection.evidence.deployments }))
      const blockNumber = BigInt(projection.asOfBlock)
      const code = await rpc.getBytecode({ address: projection.address, blockNumber })
      if (!code || code === '0x') {
        projection.support = 'no_code'
        projection.reason = 'allocator_has_no_code'
      } else if (projection.support === 'supported') {
        const calls = strategies.flatMap(strategy => allocatorRatioCalls(projection.family, projection.address as Address, vault, strategy))
        const results = calls.length ? await rpc.multicall({ contracts: calls, blockNumber, allowFailure: true }) : []
        strategies.forEach((strategy, index) => {
          const ratio = { targetDebtRatio: ratioValue(results[index * 2]), maxDebtRatio: ratioValue(results[index * 2 + 1]) }
          projection.ratios[strategy.toLowerCase()] = ratio
          if (ratio.targetDebtRatio === null || ratio.maxDebtRatio === null) {
            projection.support = 'unavailable'
            projection.reason = 'allocator_configuration_unavailable'
          }
        })
      }
    } catch {
      projection.support = 'unavailable'
      projection.reason = 'allocator_configuration_unavailable'
      projection.ratios = {}
    }
  }
  projection.revision = createHash('sha256').update(JSON.stringify({ ...projection, observedAt: undefined })).digest('hex')
  if (projection.address) projection.address = getAddress(projection.address)
  return projection
}
