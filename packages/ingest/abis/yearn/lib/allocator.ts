import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError, getAddress, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem'

export interface AllocatorRatios {
  targetDebtRatio: number | null
  maxDebtRatio: number | null
}

export interface VaultAllocator {
  address: Address | null
  ratios: Record<string, AllocatorRatios>
}

type Rpc = Pick<PublicClient, 'readContract' | 'multicall'>
type CallResult = { status: string; result?: unknown }
const RATIO_GETTERS = ['getStrategyTargetRatio', 'getStrategyMaxRatio'] as const
const INTERFACES = [false, true] as const
const CALLS_PER_STRATEGY = INTERFACES.length * RATIO_GETTERS.length
const emptyRatios = (): AllocatorRatios => ({ targetDebtRatio: null, maxDebtRatio: null })

function validRatio(call: CallResult | undefined): number | null {
  return call?.status === 'success' && typeof call.result === 'bigint' && call.result >= 0n && call.result <= 10_000n
    ? Number(call.result) : null
}

export function selectAllocatorRatios(results: readonly CallResult[]): AllocatorRatios {
  const pairs = INTERFACES.map((_, index) => index * RATIO_GETTERS.length).map(offset => ({
    targetDebtRatio: validRatio(results[offset]), maxDebtRatio: validRatio(results[offset + 1])
  })).filter(pair => pair.targetDebtRatio !== null && pair.maxDebtRatio !== null)
  if (pairs.length === 2 && (pairs[0].targetDebtRatio !== pairs[1].targetDebtRatio || pairs[0].maxDebtRatio !== pairs[1].maxDebtRatio)) {
    console.warn('Conflicting allocator ratio interfaces')
    return emptyRatios()
  }
  return pairs[0] ?? emptyRatios()
}

export function ratiosFor(allocator: VaultAllocator, strategy: Address): AllocatorRatios {
  return allocator.ratios[strategy.toLowerCase()] ?? emptyRatios()
}

// viem 2.5 also wraps provider internal errors as contract reverts and drops
// their RPC code. Only explicit revert evidence or an empty return establishes
// that a getter is unavailable; ambiguous failures must retry the snapshot.
function isUnsupportedGetter(error: unknown): boolean {
  const cause = error instanceof ContractFunctionExecutionError ? error.cause : undefined
  const reverted = cause instanceof ContractFunctionRevertedError &&
    (cause.data !== undefined || cause.signature !== undefined || /^execution reverted\b/i.test(cause.reason ?? ''))
  return reverted || cause instanceof ContractFunctionZeroDataError
}

// Snapshot multicalls discard per-field errors. Confirm a missing manager at
// the same block so tokenized strategies can refresh without masking RPC faults.
export async function readRoleManager(vault: Address, blockNumber: bigint, rpc: Rpc): Promise<Address | undefined> {
  try {
    return getAddress(await rpc.readContract({
      address: vault, abi: parseAbi(['function role_manager() view returns (address)']),
      functionName: 'role_manager', blockNumber
    }))
  } catch (error) {
    if (isUnsupportedGetter(error)) return undefined
    throw error
  }
}

// The manager comes from the vault read at blockNumber. Required read failures
// propagate to the snapshot job: no factory fallback and no fabricated clear.
export async function readVaultAllocator(vault: Address, manager: Address | undefined, strategies: Address[], blockNumber: bigint, rpc: Rpc): Promise<VaultAllocator> {
  if (!manager) throw new Error('Vault role manager read unavailable')
  if (manager === zeroAddress) return { address: null, ratios: {} }
  let assigned: Address
  try {
    assigned = getAddress(await rpc.readContract({
      address: manager, abi: parseAbi(['function getDebtAllocator(address) view returns (address)']),
      functionName: 'getDebtAllocator', args: [vault], blockNumber
    }))
  } catch (error) {
    if (isUnsupportedGetter(error)) {
      console.warn('Allocator assignment unavailable', vault, manager, blockNumber)
      return { address: null, ratios: {} }
    }
    throw error
  }
  if (assigned === zeroAddress) return { address: null, ratios: {} }
  const contracts = strategies.flatMap(strategy => INTERFACES.flatMap(shared =>
    RATIO_GETTERS.map(functionName => ({
      address: assigned, functionName,
      abi: parseAbi([`function ${functionName}(${shared ? 'address,address' : 'address'}) view returns (uint256)`]),
      args: shared ? [vault, strategy] : [strategy]
    }))
  ))
  // A transport failure rejects the job; per-contract failures become null
  // ratios. Never reuse another allocator's configuration after replacement.
  const results = contracts.length ? await rpc.multicall({ contracts, blockNumber, allowFailure: true }) : []
  // viem also wraps failed aggregate RPC requests in per-call failures when
  // allowFailure is enabled. Only getter execution/decoding failures are data.
  for (const result of results) {
    if (result.status !== 'failure') continue
    const error = result.error
    if (!(error instanceof ContractFunctionExecutionError) || !RATIO_GETTERS.some(name => name === error.functionName)) {
      throw error
    }
  }
  return { address: assigned, ratios: Object.fromEntries(strategies.map((strategy, index) =>
    [strategy.toLowerCase(), selectAllocatorRatios(results.slice(index * CALLS_PER_STRATEGY, (index + 1) * CALLS_PER_STRATEGY))]
  )) }
}
