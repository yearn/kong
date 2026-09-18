import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError, getAddress, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem'

// Preserve existing data only while these retired vaults retain their legacy
// controllers. This is not a chain-wide exclusion or a factory-log fallback.
const legacyControllers: Record<string, string> = {
  '0xa21cc1a4a239708690134baed3a1b93cad55f625': '0xfb4464a18d18f3ff439680bbbce659db2806a187',
  '0x39b68451f05aaa020611cf887a7338f0991ffd60': '0xf9b85835b023adb7e7b3bd3529b5cd967920e8ec',
  '0x5012c6bf79b3047ecfff2f212dffda4d2128188f': '0x22eae41c7da367b9a15e942eb6227df849bb498c'
}

export function isLegacyAllocator(chainId: number, vault: string, manager: unknown): boolean {
  return chainId === 100 && typeof manager === 'string' &&
    legacyControllers[vault.toLowerCase()] === manager.toLowerCase()
}

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

type Hook = Record<string, unknown>
type Row = Record<string, unknown>

export function preserveLegacyAllocator(current: Hook, incoming: Hook): Hook {
  const result = { ...incoming, allocator: current.allocator ?? null }
  for (const field of ['debts', 'composition']) {
    const previous = current[field] as Row[] | undefined
    const next = incoming[field] as Row[] | undefined
    if (!Array.isArray(next)) continue
    const keys = new Set(next.map(row => String(row.strategy ?? row.address).toLowerCase()))
    if (Array.isArray(previous) && previous.some(row => !keys.has(String(row.strategy ?? row.address).toLowerCase()))) {
      throw new Error('Legacy allocator strategy rows missing; retry snapshot')
    }
    const byStrategy = new Map((Array.isArray(previous) ? previous : []).map(row =>
      [String(row.strategy ?? row.address).toLowerCase(), row]
    ))
    Object.assign(result, { [field]: next.map(row => {
      const saved = byStrategy.get(String(row.strategy ?? row.address).toLowerCase())
      return { ...row, targetDebtRatio: saved?.targetDebtRatio ?? null, maxDebtRatio: saved?.maxDebtRatio ?? null }
    }) })
  }
  return result
}
