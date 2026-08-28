import { Output } from 'lib/types'
import { Data } from '../../../../../../../extract/timeseries'
import _process from '../../../../../lib/apy'

export const outputLabel = 'apy-bwd-delta-pps'

// Unchanged historical apy: same label, components, sampling, annualization and
// compounding as any other vault. Only the pps observations it samples differ,
// and that happens inside the shared reader.
export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, 'vault', data)
}
