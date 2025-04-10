import { Output, OutputSchema, StrategySchema, Thing, ThingSchema } from 'lib/types'
import { Data } from '../../../../../../extract/timeseries'
import { first, query } from '../../../../../../db'
import { compare } from 'compare-versions'
import { multicall3 } from 'lib'
import { getBlock, estimateHeight } from 'lib/blocks'
import * as snapshot__v2 from '../../snapshot/hook'
import * as snapshot__v3 from '../../../../3/vault/snapshot/hook'
import { computeChainAPY } from '../../../../../../forward'
import { getVaultStrategyIndicators } from '../../../../../../forward/helpers/strategies.helper'

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

  const vault = await first<Thing>(ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, 'vault']
  )

  if (!vault) return []

  const strategiesAddress: `0x${string}`[] = []
  if (compare(vault.defaults.apiVersion, '3.0.0', '>=')) {
    strategiesAddress.push(...await snapshot__v3.projectStrategies(chainId, address, blockNumber))
  } else {
    strategiesAddress.push(...await snapshot__v2.projectStrategies(chainId, address, blockNumber))
  }

  const strategies = await query(StrategySchema,`
        SELECT * FROM thing WHERE address in($1) AND chain_id = $2 and label = $3
    `, [strategiesAddress, chainId, 'strategy'])

  const strategiesWithIndicators = await Promise.all(strategies.map(async (strategy) => {
    const indicators = await getVaultStrategyIndicators(vault.address, chainId, strategy.address)
    return {
      ...strategy,
      ...indicators
    }
  }))

  const forwardAPY = await computeChainAPY(vault, chainId, strategiesWithIndicators)

  if(forwardAPY) {
    return OutputSchema.array().parse([{
      chainId, address, label: data.outputLabel, component: 'netAPY',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.netAPY)
    }, {
      chainId, address, label: data.outputLabel, component: 'boost',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.boost)
    }, {
      chainId, address, label: data.outputLabel, component: 'poolAPY',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.poolAPY)
    }, {
      chainId, address, label: data.outputLabel, component: 'boostedAPR',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.boostedAPR)
    }, {
      chainId, address, label: data.outputLabel, component: 'baseAPR',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.baseAPR)
    }, {
      chainId, address, label: data.outputLabel, component: 'rewardsAPY',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.rewardsAPY)
    }, {
      chainId, address, label: data.outputLabel, component: 'cvxAPR',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.cvxAPR)
    }, {
      chainId, address, label: data.outputLabel, component: 'keepCRV',
      blockNumber, blockTime: data.blockTime, value: Number(forwardAPY.keepCRV)
    }])
  }

  return []
}