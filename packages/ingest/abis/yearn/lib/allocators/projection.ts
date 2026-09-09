import { createHash } from 'node:crypto'
import { getAddress, parseAbi, toEventSelector, zeroAddress, type Address, type PublicClient } from 'viem'
import { z } from 'zod'
import { abis } from 'lib/abis'
import db from '../../../../db'
import { blockEndPosition, resolveAllocatorAssignment } from 'lib/allocators'
import type { AllocationSourceEvent, AllocatorDeploymentEvidence, AllocatorResolution } from 'lib/allocator-types'

const AddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(value => value.toLowerCase() as Address)
const assignmentSignatures = [
  'AddedNewVault(address,address,uint256)', 'UpdateDebtAllocator(address,address)',
  'RemovedVault(address)', 'UpdateRoleManager(address)'
].map(toEventSelector)
const EventSchema = z.object({
  id: z.string(), sourceAddress: AddressSchema, vaultAddress: AddressSchema,
  blockNumber: z.coerce.number().int().nonnegative(), transactionIndex: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative(), eventName: z.enum(['AddedNewVault', 'UpdateDebtAllocator', 'RemovedVault', 'UpdateRoleManager']),
  args: z.record(z.unknown())
})

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
  stale?: boolean
  lastAttemptAt?: string
  lastError?: string | null
  ratios: Record<string, AllocatorRatio>
  evidence: { events: AllocationSourceEvent[]; deployments: AllocatorDeploymentEvidence[] }
}

type Rpc = Pick<PublicClient, 'getBlock' | 'readContract' | 'getBytecode' | 'multicall'>

// Kong's extractor stores every decoded ABI event, independently of event hooks.
// Factory logs describe deployment; only the manager's logs describe assignment.
export async function loadAllocatorAssignments(chainId: number, vault: Address, toBlock: number, manager: Address) {
  const { rows } = await db.query(`
    SELECT transaction_hash || ':' || log_index AS id, address AS "sourceAddress",
      $2::text AS "vaultAddress", event_name AS "eventName", args,
      block_number AS "blockNumber", transaction_index AS "transactionIndex", log_index AS "logIndex"
    FROM evmlog WHERE chain_id = $1 AND address = ANY($4::text[])
      AND signature = ANY($6::text[]) AND block_number <= $3 AND (
      (event_name IN ('AddedNewVault', 'UpdateDebtAllocator', 'RemovedVault') AND lower(args->>'vault') = $2)
      OR (event_name = 'UpdateRoleManager' AND address = $5)
    ) ORDER BY block_number, transaction_index, log_index, transaction_hash`,
  [chainId, vault.toLowerCase(), toBlock, [getAddress(vault), getAddress(manager)], getAddress(vault), assignmentSignatures])
  return EventSchema.array().parse(rows)
}

export async function loadAllocatorDeployments(chainId: number, allocator: Address, toBlock: number): Promise<AllocatorDeploymentEvidence[]> {
  const factories = abis.flatMap(abi => {
    const family = abi.abiPath === 'yearn/3/debtManagerFactory' ? 'vault_bound'
      : abi.abiPath === 'yearn/3/sharedDebtAllocatorFactory' ? 'shared' : null
    return family ? abi.sources.filter(source => source.chainId === chainId)
      .map(source => ({ address: getAddress(source.address), family })) : []
  })
  if (!factories.length) return []
  const { rows } = await db.query(`
    SELECT address, args, block_number AS "createdBlock", transaction_hash || ':' || log_index AS id
    FROM evmlog WHERE chain_id = $1 AND event_name = 'NewDebtAllocator'
      AND address = ANY($2::text[]) AND lower(args->>'allocator') = $3 AND block_number <= $4
    ORDER BY block_number, transaction_index, log_index`,
  [chainId, factories.map(factory => factory.address), allocator.toLowerCase(), toBlock])
  const schema = z.object({ address: AddressSchema, args: z.object({ allocator: AddressSchema,
    vault: AddressSchema.optional(), governance: AddressSchema.optional() }), createdBlock: z.coerce.number().int().nonnegative(), id: z.string() })
  const result = schema.array().parse(rows).map(row => {
    const factory = factories.find(factory => factory.address.toLowerCase() === row.address)
    if (!factory || row.args.allocator !== allocator.toLowerCase()) throw new Error('allocator_deployment_mismatch')
    return { allocatorAddress: row.args.allocator, factoryAddress: row.address,
      family: factory.family as AllocatorDeploymentEvidence['family'],
      boundVaultAddress: row.args.vault ?? null, governanceAddress: row.args.governance ?? null,
      createdBlock: row.createdBlock, sourceEventId: row.id,
      abiVariant: factory.family === 'shared' ? 'shared-v1' : 'generic-v1' }
  })
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
    sourceRevision: 'kong-evmlog-v1',
    blockHash: null, observedAt: new Date().toISOString(), ratios: {}, evidence: { events: [], deployments: [] }
  }
  try {
    const block = await rpc.getBlock({ blockTag: 'finalized' })
    if (block.number === null || !block.hash) throw new Error('allocator_block_unavailable')
    const blockNumber = block.number
    projection.asOfBlock = Number(blockNumber)
    projection.blockHash = block.hash
    const roleManager = await rpc.readContract({ address: vault, abi: parseAbi(['function role_manager() view returns (address)']), functionName: 'role_manager', blockNumber })
    const manager = AddressSchema.parse(roleManager)
    const rows = await loadAllocatorAssignments(chainId, vault, Number(blockNumber), manager)
    projection.roleManagerAddress = manager
    projection.evidence.events = rows
    const resolved = resolveAllocatorAssignment({ vaultAddress: vault, events: projection.evidence.events,
      at: blockEndPosition(Number(blockNumber)), roleManagerAddress: manager })
    if (resolved.roleManagerAddress !== manager) throw new Error('role_manager_evidence_mismatch')
    if (resolved.status === 'unavailable' && resolved.reason !== 'vault_removed_from_role_manager') return { ...projection, ...resolved }
    const observed = AddressSchema.parse(await rpc.readContract({ address: manager,
      abi: parseAbi(['function getDebtAllocator(address) view returns (address)']), functionName: 'getDebtAllocator', args: [vault], blockNumber }))
    if (observed !== (resolved.address ?? zeroAddress)) throw new Error('allocator_assignment_mismatch')
    Object.assign(projection, resolved)
  } catch {
    // Required assignment evidence failed. Do not substitute a factory address or an old assignment.
    return { ...projection, address: null, assignmentId: null, status: 'unavailable', reason: 'assignment_evidence_unavailable', support: 'unavailable' }
  }
  if (projection.address) {
    try {
      projection.evidence.deployments = await loadAllocatorDeployments(chainId, projection.address, projection.asOfBlock)
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
