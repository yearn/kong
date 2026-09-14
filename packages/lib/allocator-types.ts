export type Address = `0x${string}`
export interface AllocationSourceEvent {
  id: string
  vaultAddress?: Address | null
  sourceAddress: Address
  eventName: string
  args: Record<string, unknown>
  blockNumber: number
  transactionIndex: number
  logIndex: number
}
export type AllocatorFamily = 'vault_bound' | 'shared' | 'unknown'

export interface AllocatorDeploymentEvidence {
  allocatorAddress: Address
  factoryAddress: Address
  family: Exclude<AllocatorFamily, 'unknown'>
  boundVaultAddress: Address | null
  governanceAddress: Address | null
  createdBlock: number
  sourceEventId: string
  abiVariant: string
}

export interface AllocatorResolution {
  address: Address | null
  assignmentId: string | null
  roleManagerAddress: Address | null
  status: 'assigned' | 'cleared' | 'unavailable'
  reason: string | null
  family: AllocatorFamily
  support: 'supported' | 'unsupported' | 'no_code' | 'unavailable'
  asOfBlock: number
  deploymentSourceEventId: string | null
}
