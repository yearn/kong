import { Output } from 'lib/types'
import { Data } from '../../../../../../extract/timeseries'
import _process, { processTvlGroup } from '../../../../lib/tvl'

export const outputLabel = 'tvl-c'
export const outputGroup = {
  key: 'yearn-tvl',
  labels: ['tvl', 'tvl-c'],
  process: processTvlGroup
}

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, data, true)
}
