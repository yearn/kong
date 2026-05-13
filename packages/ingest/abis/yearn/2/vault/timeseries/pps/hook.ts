import { Data } from '../../../../../../extract/timeseries'
import { Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { firstRow } from '../../../../../../db'
import { estimateHeight, getBlock } from 'lib/blocks'
import { multicall3 } from 'lib'
import { ReadContractParameters } from 'viem'
import { rpcs } from '../../../../../../rpcs'
import abi from '../../abi'
import { div } from 'lib/math'

export const outputLabel = 'pps'

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

  const vaultRow = await firstRow('SELECT defaults FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3', [chainId, address, 'vault'])
  if (!vaultRow) return []
  const vault = ThingSchema.parse({ chainId, address, label: 'vault', defaults: vaultRow.defaults })

  const pps = await _compute(vault, blockNumber)
  if (!pps) return []

  return OutputSchema.array().parse([{ 
    chainId, address, label: data.outputLabel, component: 'raw',
    blockNumber: pps.number, blockTime: pps.timestamp, value: Number(pps.raw)
  }, {
    chainId, address, label: data.outputLabel, component: 'humanized',
    blockNumber: pps.number, blockTime: pps.timestamp, value: pps.humanized
  }])
}

export async function _compute(vault: Thing, blockNumber: bigint) {
  const { chainId, address } = vault
  const block = await getBlock(chainId, blockNumber)
  const ppsParameters = { abi, address, functionName: 'pricePerShare' } as ReadContractParameters
  const raw = await rpcs.next(chainId, blockNumber).readContract({...ppsParameters, blockNumber}) as bigint
  const humanized = div(raw, 10n ** BigInt(vault.defaults.decimals ?? 0n))
  return { ...block, raw, humanized }
}
