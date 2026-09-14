import type { Address, AllocationSourceEvent, AllocatorDeploymentEvidence, AllocatorResolution } from './allocator-types'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

export interface AllocationPosition {
  blockNumber: number
  transactionIndex: number
  logIndex: number
  id: string
}

export function allocationAddress(value: unknown): Address | null {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value.toLowerCase() as Address) : null
}

export function compareAllocationPosition(left: AllocationPosition, right: AllocationPosition): number {
  return (
    left.blockNumber - right.blockNumber ||
    left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex ||
    left.id.localeCompare(right.id)
  )
}

export function blockEndPosition(blockNumber: number): AllocationPosition {
  return { blockNumber, transactionIndex: Number.MAX_SAFE_INTEGER, logIndex: Number.MAX_SAFE_INTEGER, id: '\uffff' }
}

export function resolveAllocatorAssignment(input: {
  vaultAddress: Address
  events: readonly AllocationSourceEvent[]
  at: AllocationPosition
  roleManagerAddress: Address | null
  deployments?: readonly AllocatorDeploymentEvidence[]
}): AllocatorResolution {
  const vault = input.vaultAddress.toLowerCase()
  const events = input.events
    .filter((event) => compareAllocationPosition(event, input.at) <= 0)
    .filter((event) => (event.vaultAddress ?? allocationAddress(event.args.vault) ?? vault).toLowerCase() === vault)
    .sort(compareAllocationPosition)
  const managerChange = events.slice().reverse().find((event) => event.eventName === 'UpdateRoleManager' && event.sourceAddress.toLowerCase() === vault)
  const manager = managerChange
    ? allocationAddress(managerChange.args.roleManager ?? managerChange.args.role_manager)
    : allocationAddress(input.roleManagerAddress)
  const base: AllocatorResolution = {
    address: null,
    assignmentId: null,
    roleManagerAddress: manager,
    status: 'unavailable',
    reason: 'assignment_evidence_unavailable',
    family: 'unknown',
    support: 'unavailable',
    asOfBlock: input.at.blockNumber,
    deploymentSourceEventId: null
  }
  if (!manager || manager === ZERO_ADDRESS) return { ...base, reason: 'role_manager_unavailable' }

  const assignment = events.slice().reverse().find(
    (event) =>
      event.sourceAddress.toLowerCase() === manager &&
      ['AddedNewVault', 'UpdateDebtAllocator', 'RemovedVault'].includes(event.eventName)
  )
  if (!assignment) return base
  if (assignment.eventName === 'RemovedVault') return { ...base, assignmentId: assignment.id, reason: 'vault_removed_from_role_manager' }
  const address = allocationAddress(assignment.args.debtAllocator)
  if (!address) return { ...base, assignmentId: assignment.id, reason: 'invalid_assignment_address' }
  if (address === ZERO_ADDRESS) {
    return { ...base, assignmentId: assignment.id, status: 'cleared', reason: null }
  }
  const deployment = input.deployments?.find(
    (row) => row.allocatorAddress.toLowerCase() === address && row.createdBlock <= input.at.blockNumber
  )
  const supported =
    deployment && (deployment.family === 'shared' || deployment.boundVaultAddress?.toLowerCase() === vault)
  return {
    ...base,
    address,
    assignmentId: assignment.id,
    status: 'assigned',
    reason: supported ? null : 'allocator_interface_unsupported',
    family: deployment?.family ?? 'unknown',
    support: supported ? 'supported' : 'unsupported',
    deploymentSourceEventId: deployment?.sourceEventId ?? null
  }
}
