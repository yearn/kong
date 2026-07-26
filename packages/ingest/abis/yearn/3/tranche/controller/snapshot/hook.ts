import { mq } from 'lib'
import { estimateCreationBlock } from 'lib/blocks'
import { EvmAddress, EvmAddressSchema, ThingSchema } from 'lib/types'
import { z } from 'zod'
import { rpcs } from '../../../../../../rpcs'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../../lib'
import trancheAbi from '../../vault/abi'
import abi from '../abi'

// The automatic snapshot only captures the controller's zero-argument state.
// Everything per-tranche — priority order, accounting, coverage — needs the
// tranche address as an argument, so this hook appends it as an ordered
// `tranches` array. Every appended read uses the automatic snapshot's block so
// the whole row describes one point in time.
export const TrancheAccountingSchema = z.object({
  address: EvmAddressSchema,
  priority: z.number(),
  registered: z.boolean(),
  accrualPaused: z.boolean(),
  excessShareBps: z.number(),
  targetRatePerSecondWad: z.bigint({ coerce: true }),
  baselineAssets: z.bigint({ coerce: true }),
  lastAccrual: z.bigint({ coerce: true }),
  pendingExcess: z.bigint({ coerce: true }),
  liveAssets: z.bigint({ coerce: true }),
  claim: z.bigint({ coerce: true }),
  covered: z.bigint({ coerce: true })
})

export type TrancheAccounting = z.infer<typeof TrancheAccountingSchema>

export const SnapshotSchema = z.object({
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  VAULT: EvmAddressSchema,
  ASSET: EvmAddressSchema,
  reserveVault: EvmAddressSchema.optional(),
  tranchesLength: z.bigint({ coerce: true }).optional()
})

type Snapshot = z.infer<typeof SnapshotSchema>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const snapshot = SnapshotSchema.parse(data)
  const { blockNumber } = snapshot

  const addresses = await extractTranchesByPriority(chainId, address, snapshot.tranchesLength, blockNumber)
  const tranches = await extractTrancheAccounting(chainId, address, addresses, blockNumber)

  await projectTrancheThings(chainId, address, snapshot, tranches)

  return { tranches }
}

// Discovery walks tranchesByPriority(index) rather than getTranchesByPriority()
// so priority is read one slot at a time and stays meaningful per entry.
export async function extractTranchesByPriority(
  chainId: number,
  controller: `0x${string}`,
  tranchesLength: bigint | undefined,
  blockNumber: bigint
): Promise<EvmAddress[]> {
  const length = Number(tranchesLength ?? 0n)
  if (length === 0) return []

  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: Array.from({ length }, (_, index) => ({
      address: controller, abi, functionName: 'tranchesByPriority', args: [BigInt(index)]
    })),
    blockNumber
  })

  throwOnMulticallError(multicall)
  return multicall.map(result => EvmAddressSchema.parse(result.result))
}

export async function extractTrancheAccounting(
  chainId: number,
  controller: `0x${string}`,
  tranches: EvmAddress[],
  blockNumber: bigint
): Promise<TrancheAccounting[]> {
  if (tranches.length === 0) return []

  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: tranches.flatMap(tranche => [
      { address: controller, abi, functionName: 'tranches', args: [tranche] },
      { address: controller, abi, functionName: 'liveAssets', args: [tranche] },
      { address: controller, abi, functionName: 'trancheCoverage', args: [tranche] }
    ]),
    blockNumber
  })

  throwOnMulticallError(multicall)

  return tranches.map((address, priority) => {
    const [
      registered, accrualPaused, excessShareBps, targetRatePerSecondWad,
      baselineAssets, lastAccrual, pendingExcess
    ] = multicall[priority * 3 + 0].result as unknown as readonly [boolean, boolean, number, bigint, bigint, bigint, bigint]
    const liveAssets = multicall[priority * 3 + 1].result as bigint
    const [claim, covered] = multicall[priority * 3 + 2].result as unknown as readonly [bigint, bigint]

    return TrancheAccountingSchema.parse({
      address,
      priority,
      registered,
      accrualPaused,
      excessShareBps,
      targetRatePerSecondWad,
      baselineAssets,
      lastAccrual,
      pendingExcess,
      liveAssets,
      claim,
      covered
    })
  })
}

// Tranches are user-facing ERC-4626 vaults built on TokenizedStrategy, so each
// one gets `vault` and `strategy` things alongside its `tranche` thing. The
// `tranche` default is what keeps the generic yearn/3/vault and
// yearn/3/strategy paths from claiming the same address (see config/abis.yaml).
export const TRANCHE_THING_LABELS = ['tranche', 'vault', 'strategy'] as const

async function projectTrancheThings(
  chainId: number,
  controller: `0x${string}`,
  snapshot: Snapshot,
  tranches: TrancheAccounting[]
) {
  if (tranches.length === 0) return

  const asset = await fetchOrExtractErc20(chainId, snapshot.ASSET)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: asset.address, label: 'erc20', defaults: asset
  }))

  for (const tranche of tranches) {
    const meta = await extractTrancheMeta(chainId, tranche.address, snapshot.blockNumber)
    const incept = await estimateCreationBlock(chainId, tranche.address)

    const defaults = {
      trancheController: controller,
      priority: tranche.priority,
      trancheType: meta.trancheType,
      asset: snapshot.ASSET,
      mainVault: snapshot.VAULT,
      inceptBlock: incept.number,
      inceptTime: incept.timestamp,
      erc4626: true,
      v3: true,
      yearn: true,
      tranche: true,
      origin: 'yearn',
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      apiVersion: meta.apiVersion
    }

    for (const label of TRANCHE_THING_LABELS) {
      await mq.add(mq.job.load.thing, ThingSchema.parse({
        chainId, address: tranche.address, label, defaults
      }))
    }
  }
}

// `trancheType` records which implementation a tranche runs, not its deployment
// nickname: A/B/E are configuration, not protocol types. Locked tranches are the
// ones exposing cooldown configuration — base tranches revert on the call.
export async function extractTrancheMeta(chainId: number, tranche: `0x${string}`, blockNumber: bigint) {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address: tranche, abi: trancheAbi, functionName: 'name' },
      { address: tranche, abi: trancheAbi, functionName: 'symbol' },
      { address: tranche, abi: trancheAbi, functionName: 'decimals' },
      { address: tranche, abi: trancheAbi, functionName: 'apiVersion' },
      { address: tranche, abi: trancheAbi, functionName: 'cooldownDuration' }
    ],
    blockNumber,
    allowFailure: true
  })

  const [name, symbol, decimals, apiVersion, cooldownDuration] = multicall
  throwOnMulticallError([name, symbol, decimals, apiVersion])

  return {
    name: name.result as string,
    symbol: symbol.result as string,
    decimals: Number(decimals.result),
    apiVersion: apiVersion.result as string,
    trancheType: cooldownDuration.status === 'success' ? 'locked' : 'base'
  }
}
