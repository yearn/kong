import { EvmAddressSchema } from 'lib/types'
import { zeroAddress } from 'viem'
import { z } from 'zod'
import { rpcs } from '../../../../../../rpcs'
import hookAbi from '../../hook/abi'

// The automatic snapshot stores the tranche's `hook()` return value as the raw
// `hook` address. Hook state is parameterized by tranche, so it can't come from
// the automatic snapshot — this hook reads it at the same block and appends it
// under `hookState`. The distinction matters: `hook` is the address, `hookState`
// is what that Hook currently reports for this tranche. The Hook itself gets no
// thing and no snapshot of its own.
export const RateLimitSchema = z.object({
  used: z.bigint({ coerce: true }),
  windowStart: z.bigint({ coerce: true }),
  rateLimit: z.bigint({ coerce: true })
})

export const HookStateSchema = z.object({
  open: z.boolean(),
  rateLimitWindow: z.bigint({ coerce: true }),
  depositLimit: z.bigint({ coerce: true }),
  depositRateLimit: RateLimitSchema,
  withdrawRateLimit: RateLimitSchema,
  depositCap: z.bigint({ coerce: true }),
  withdrawCap: z.bigint({ coerce: true })
})

export type HookState = z.infer<typeof HookStateSchema>

export const SnapshotSchema = z.object({
  blockNumber: z.bigint({ coerce: true }),
  hook: EvmAddressSchema.optional()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { hook, blockNumber } = SnapshotSchema.parse(data)
  if (!hook || hook === zeroAddress) return {}

  const hookState = await extractHookState(chainId, hook, address, blockNumber)
  if (!hookState) return {}

  return { hookState }
}

// Rate limits are fixed-window counters, stored exactly as the Hook reports
// them: a bucket expires when blockTime >= windowStart + rateLimitWindow, and
// deriving effective usage is left to consumers, which know the timestamp they
// are answering for.
export async function extractHookState(
  chainId: number,
  hook: `0x${string}`,
  tranche: `0x${string}`,
  blockNumber: bigint
): Promise<HookState | undefined> {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address: hook, abi: hookAbi, functionName: 'open' },
      { address: hook, abi: hookAbi, functionName: 'rateLimitWindow' },
      { address: hook, abi: hookAbi, functionName: 'depositLimits', args: [tranche] },
      { address: hook, abi: hookAbi, functionName: 'depositRateLimit', args: [tranche] },
      { address: hook, abi: hookAbi, functionName: 'withdrawRateLimit', args: [tranche] },
      { address: hook, abi: hookAbi, functionName: 'depositCap', args: [tranche] },
      { address: hook, abi: hookAbi, functionName: 'withdrawCap', args: [tranche] }
    ],
    blockNumber,
    allowFailure: true
  })

  // A tranche can point at a hook that doesn't implement this interface. Skip
  // enrichment rather than fail the whole snapshot — the raw `hook` address is
  // already stored and is the thing a reader needs to investigate.
  if (multicall.some(result => result.status !== 'success')) {
    console.warn('🚨', '!hookState', chainId, tranche, hook, blockNumber)
    return undefined
  }

  const [open, rateLimitWindow, depositLimit, depositRateLimit, withdrawRateLimit, depositCap, withdrawCap] = multicall
  const [depositUsed, depositWindowStart, depositRate] = depositRateLimit.result as readonly [bigint, bigint, bigint]
  const [withdrawUsed, withdrawWindowStart, withdrawRate] = withdrawRateLimit.result as readonly [bigint, bigint, bigint]

  return HookStateSchema.parse({
    open: open.result,
    rateLimitWindow: rateLimitWindow.result,
    depositLimit: depositLimit.result,
    depositRateLimit: { used: depositUsed, windowStart: depositWindowStart, rateLimit: depositRate },
    withdrawRateLimit: { used: withdrawUsed, windowStart: withdrawWindowStart, rateLimit: withdrawRate },
    depositCap: depositCap.result,
    withdrawCap: withdrawCap.result
  })
}
