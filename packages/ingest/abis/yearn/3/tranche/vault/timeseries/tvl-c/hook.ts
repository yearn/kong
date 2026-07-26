import { Output } from 'lib/types'
import { Data } from '../../../../../../../extract/timeseries'
import _process from '../../../../../lib/tvl'

export const outputLabel = 'tvl-c'

// Tranche tvl is a claim on the main vault's backing, not additional protocol
// assets, so it is emitted from controller-backed liveAssets. There is
// deliberately no sibling `tvl` hook: the legacy label is what naive aggregates
// sum, and summing main-vault tvl with tranche tvl would double count the same
// underlying assets.
export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, data, true)
}
