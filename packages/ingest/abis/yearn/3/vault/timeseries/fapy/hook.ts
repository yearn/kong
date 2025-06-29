import { Output, OutputSchema } from 'lib/types'
import { Data } from '../../../../../../extract/timeseries'
import { computeChainAPY } from '../../../../lib/fapy'
import { multicall3 } from 'lib'
import { getBlock, estimateHeight } from 'lib/blocks'
import { getThingWithName } from 'lib/queries/thing'
import { getVaultStrategies } from 'lib/queries/strategy'

export const outputLabel = 'fapy'

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  console.info('Fapy 🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

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

  const vault = await getThingWithName(chainId, address, 'vault')

  if (!vault) return []

  const strategies = await getVaultStrategies(chainId, address)

  const vaultAPY = await computeChainAPY(vault, chainId, strategies)

  if(vaultAPY) {
    return OutputSchema.array().parse([
      {
        chainId, address, label: data.outputLabel, component: 'forwardAPRType',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.type ?? ''
      },
      {
        chainId, address, label: data.outputLabel, component: 'forwardNetAPY',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.netAPR
      }, {
        chainId, address, label: data.outputLabel, component: 'forwardBoost',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.boost
      }, {
        chainId, address, label: data.outputLabel, component: 'poolAPY',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.poolAPY
      }, {
        chainId, address, label: data.outputLabel, component: 'boostedAPR',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.boostedAPR
      }, {
        chainId, address, label: data.outputLabel, component: 'baseAPR',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.baseAPR
      }, {
        chainId, address, label: data.outputLabel, component: 'rewardsAPY',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.rewardsAPY
      }, {
        chainId, address, label: data.outputLabel, component: 'cvxAPR',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.cvxAPR
      }, {
        chainId, address, label: data.outputLabel, component: 'keepCRV',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.keepCRV
      }])
  }

  return []
}
