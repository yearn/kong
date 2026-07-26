import { multicall3 } from 'lib'
import { estimateHeight, getBlock } from 'lib/blocks'
import { div, normalize } from 'lib/math'
import { Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { first } from '../../../../../../../db'
import { Data } from '../../../../../../../extract/timeseries'
import { extractTrancheAccounting } from '../../../controller/snapshot/hook'
import { trancheControllerOf } from '../../../../../lib/assets'

export const outputLabel = 'tranche-accounting'

// Per-tranche controller accounting over time. The controller — not the tranche —
// is the source of truth for what a tranche has accrued, what it has been
// assigned but not yet realized, and how much of its claim is actually covered,
// so every component here is read from the controller at one historical block.
export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  let blockNumber: bigint = 0n
  if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
    blockNumber = (await getBlock(chainId)).number
  } else {
    blockNumber = await estimateHeight(chainId, data.blockTime)
  }

  if(!multicall3.supportsBlock(chainId, blockNumber)) {
    console.warn('🚨', 'block not supported', chainId, blockNumber)
    return []
  }

  const tranche = await first<Thing>(ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, 'tranche']
  )

  if (!tranche) return []

  const controller = trancheControllerOf(tranche)
  if (!controller) return []

  const decimals = Number(tranche.defaults.decimals ?? 0)

  // A block before registration reads as an unregistered tranche rather than
  // reverting, so early observations are real zeros. A failed read is not:
  // emit nothing so a bad rpc response can't be mistaken for empty accounting.
  const accounting = await extractTrancheAccounting(chainId, controller, [address], blockNumber)
    .catch(error => {
      console.warn('🚨', outputLabel, 'read fail', chainId, address, blockNumber, error)
      return []
    })

  if (accounting.length === 0) return []

  const { baselineAssets, pendingExcess, liveAssets, claim, covered,
    targetRatePerSecondWad, excessShareBps, accrualPaused } = accounting[0]

  const components: { component: string, value: number | undefined }[] = [
    { component: 'baselineAssets', value: normalize(baselineAssets, decimals) },
    { component: 'pendingExcess', value: normalize(pendingExcess, decimals) },
    { component: 'liveAssets', value: normalize(liveAssets, decimals) },
    { component: 'claim', value: normalize(claim, decimals) },
    { component: 'covered', value: normalize(covered, decimals) },
    // undefined rather than 1 when there is nothing to cover: a tranche with no
    // claim is not evidence of full coverage
    { component: 'coverageRatio', value: claim > 0n ? div(covered, claim) : undefined },
    { component: 'targetRatePerSecondWad', value: Number(targetRatePerSecondWad) },
    { component: 'excessShareBps', value: excessShareBps },
    { component: 'accrualPaused', value: accrualPaused ? 1 : 0 }
  ]

  const block = await getBlock(chainId, blockNumber)

  return OutputSchema.array().parse(components.map(({ component, value }) => ({
    chainId, address, label: data.outputLabel, component, value,
    blockNumber: block.number, blockTime: block.timestamp
  })))
}
