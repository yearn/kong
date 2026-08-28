import { EvmAddressSchema, Thing } from 'lib/types'
import { parseAbi } from 'viem'
import { rpcs } from '../../../rpcs'
import controllerAbi from '../3/tranche/controller/abi'

// A vault's asset balance has one authoritative source, and for tranches it is
// not the vault itself: the tranche controller holds the accounting. A tranche's
// own totalAssets() tracks its ERC-4626 balance, while the controller knows what
// the tranche has actually accrued and what losses it has absorbed. Reading
// through here keeps tvl, pps and apy agreeing on one number.
//
// liveAssets already excludes pendingExcess — profit assigned to a tranche but
// not yet realized through a strategy report — so nothing downstream should add
// it back.
export function trancheControllerOf(vault: Thing): `0x${string}` | undefined {
  const controller = vault.defaults.trancheController
  if (!controller) return undefined
  return EvmAddressSchema.parse(controller)
}

// Returns undefined when the read fails, so callers can tell a failed read from
// a genuinely empty vault (0n) instead of publishing a false zero.
export async function readAuthoritativeAssets(vault: Thing, blockNumber: bigint): Promise<bigint | undefined> {
  const { chainId, address } = vault
  const controller = trancheControllerOf(vault)
  if (!controller) return await extractTotalAssets(chainId, address, blockNumber)

  try {
    return await readLiveAssets(chainId, controller, address, blockNumber)
  } catch (error) {
    console.warn('🚨', 'readLiveAssets', 'read fail', chainId, controller, address, blockNumber)
    return undefined
  }
}

export async function readLiveAssets(
  chainId: number,
  controller: `0x${string}`,
  tranche: `0x${string}`,
  blockNumber: bigint
): Promise<bigint> {
  return await rpcs.next(chainId, blockNumber).readContract({
    address: controller, abi: controllerAbi, functionName: 'liveAssets', args: [tranche], blockNumber
  }) as bigint
}

export async function extractTotalAssets(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address, functionName: 'totalAssets', abi: parseAbi(['function totalAssets() view returns (uint256)']) },
      { address, functionName: 'estimatedTotalAssets', abi: parseAbi(['function estimatedTotalAssets() view returns (uint256)']) }
    ],
    blockNumber
  })

  if (!multicall.some(result => result.status === 'success')) {
    console.warn('🚨', 'extractTotalAssets', 'multicall fail', chainId, address, blockNumber)
    return undefined
  }

  const totalAssets = multicall[0].status === 'success' ? BigInt(multicall[0].result as bigint) : undefined
  const estimated = multicall[1].status === 'success' ? BigInt(multicall[1].result as bigint) : undefined
  return totalAssets ?? estimated ?? undefined
}

// Tranche shares are priced off controller-backed assets rather than the
// tranche's own pricePerShare(), which would quote its ERC-4626 view of itself.
export function computeTranchePps(assets: bigint, totalSupply: bigint, scale: bigint): bigint {
  if (totalSupply === 0n) return scale
  return assets * scale / totalSupply
}

// The shared price-per-share reader. Every pps observation — current, weekly,
// monthly, inception — goes through here so a tranche and an ordinary vault are
// never priced by two different rules. Throws on read failure, matching the
// direct pricePerShare() read it replaces.
export async function readPps(vault: Thing, blockNumber: bigint): Promise<bigint> {
  const { chainId, address } = vault
  const controller = trancheControllerOf(vault)

  if (!controller) {
    return await rpcs.next(chainId, blockNumber).readContract({
      address, abi: parseAbi(['function pricePerShare() view returns (uint256)']),
      functionName: 'pricePerShare', blockNumber
    }) as bigint
  }

  const [assets, totalSupply] = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address: controller, abi: controllerAbi, functionName: 'liveAssets', args: [address] },
      { address, abi: parseAbi(['function totalSupply() view returns (uint256)']), functionName: 'totalSupply' }
    ],
    blockNumber,
    allowFailure: false
  }) as [bigint, bigint]

  return computeTranchePps(assets, totalSupply, 10n ** BigInt(vault.defaults.decimals ?? 0))
}
