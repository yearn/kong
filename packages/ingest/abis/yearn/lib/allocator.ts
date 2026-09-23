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
const emptyRatios = (): AllocatorRatios => ({ targetDebtRatio: null, maxDebtRatio: null })

function validRatio(call: CallResult | undefined): number | null {
  return call?.status === 'success' && typeof call.result === 'bigint' && call.result >= 0n && call.result <= 10_000n
    ? Number(call.result) : null
}

export function selectAllocatorRatios(results: readonly CallResult[]): AllocatorRatios {
  const pairs = [0, 2].map(offset => ({
    targetDebtRatio: validRatio(results[offset]), maxDebtRatio: validRatio(results[offset + 1])
  })).filter(pair => pair.targetDebtRatio !== null && pair.maxDebtRatio !== null)
  if (pairs.length === 2 && (pairs[0].targetDebtRatio !== pairs[1].targetDebtRatio || pairs[0].maxDebtRatio !== pairs[1].maxDebtRatio)) {
    console.warn('Conflicting allocator ratio interfaces')
    return emptyRatios()
  }
  return pairs[0] ?? emptyRatios()
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
    // A contract-level revert or empty return cannot supply an assignment.
    // Publish null rather than retaining another manager's address. Transport
    // failures still reject the snapshot job and leave its prior observation.
    if (error instanceof ContractFunctionExecutionError &&
      (error.cause instanceof ContractFunctionRevertedError || error.cause instanceof ContractFunctionZeroDataError)) {
      console.warn('Allocator assignment unavailable', vault, manager, blockNumber)
      return { address: null, ratios: {} }
    }
    throw error
  }
  if (assigned === zeroAddress) return { address: null, ratios: {} }
  const contracts = strategies.flatMap(strategy => [false, true].flatMap(shared =>
    ['getStrategyTargetRatio', 'getStrategyMaxRatio'].map(functionName => ({
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
    if (result.status === 'failure' && (!(result.error instanceof ContractFunctionExecutionError) ||
      !['getStrategyTargetRatio', 'getStrategyMaxRatio'].includes(result.error.functionName))) {
      throw result.error
    }
  }
  return { address: assigned, ratios: Object.fromEntries(strategies.map((strategy, index) =>
    [strategy.toLowerCase(), selectAllocatorRatios(results.slice(index * 4, index * 4 + 4))]
  )) }
}
