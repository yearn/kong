import { Output, OutputSchema, SnapshotSchema, StrategySchema, StrategyThing, VaultThingsWithName, VaultThingsWithNameSchema } from 'lib/types'
import { Data } from '../../../../../../extract/timeseries'
import { first, query } from '../../../../../../db'
import { computeChainAPY } from '../../../../../../forward'
import console from 'console'
import { totalAssets } from '../../../strategy/event/hook'

export const outputLabel = 'fapy'

export default async function process(_chainId: number, _address: `0x${string}`, _data: Data): Promise<Output[]> {
  const chainId = 1
  const address = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88'

  const data: Data = {
    abiPath: 'yearn/3/vault',
    chainId,
    address,
    outputLabel,
    blockTime: BigInt(1734063803)
  }
  console.info('Fapy 🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  const blockNumber: bigint = 22197283n
  // if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
  //   blockNumber = (await getBlock(chainId)).number
  // } else {
  //   blockNumber = await estimateHeight(chainId, data.blockTime)
  // }

  // if(!multicall3.supportsBlock(chainId, blockNumber)) {
  //   console.warn('🚨', 'block not supported', chainId, blockNumber)
  //   return []
  // }

  const vault = await first<VaultThingsWithName>(VaultThingsWithNameSchema,
    `select thing.*, snapshot.snapshot->>'name' as name
      from thing
      join snapshot on thing.chain_id = snapshot.chain_id and thing.address = snapshot.address
      where thing.chain_id = $1 AND thing.address = $2 AND thing.label = $3 AND (thing.defaults->>'yearn')::boolean = true`,
    [chainId, address, 'vault']
  )

  // if (!vault) return []

  let strategies: StrategyThing[] = []

  const snapshot = await first(SnapshotSchema, `
      SELECT *
      FROM snapshot
      WHERE address = $1
    `, [vault.address])

  strategies = await query(StrategySchema, `
      SELECT * FROM thing
      WHERE chain_id = $1
      AND label = $2
      AND address = ANY($3)
    `, [chainId, 'strategy', snapshot.hook.withdrawalQueue ?? snapshot.hook.strategies])

  const strategiesWithIndicators = await Promise.all(strategies.map(async (strategy) => {
    return {
      ...strategy,
      token: snapshot?.snapshot.token,
      symbol: snapshot?.snapshot.symbol,
      rewards: snapshot?.snapshot.rewards,
      decimals: Number(snapshot?.snapshot.decimals),
      guardian: snapshot?.snapshot.guardian,
      blockTime: Number(snapshot?.snapshot.blockTime),
      debtRatio: Number(snapshot?.snapshot.debtRatio),
      totalDebt: BigInt(snapshot?.snapshot.totalDebt),
      totalIdle: BigInt(snapshot?.snapshot.totalIdle),
      activation: BigInt(snapshot?.snapshot.activation),
      apiVersion: snapshot?.snapshot.apiVersion,
      governance: snapshot?.snapshot.governance,
      lastReport: BigInt(snapshot?.snapshot.lastReport),
      management: snapshot?.snapshot.management,
      blockNumber: BigInt(snapshot?.snapshot.blockNumber),
      totalAssets: BigInt(snapshot?.snapshot.totalAssets),
      totalSupply: BigInt(snapshot?.snapshot.totalSupply),
      depositLimit: BigInt(snapshot?.snapshot.depositLimit),
      lockedProfit: BigInt(snapshot?.snapshot.lockedProfit),
      managementFee: Number(snapshot?.snapshot.managementFee),
      pricePerShare: BigInt(snapshot?.snapshot.pricePerShare),
      expectedReturn: BigInt(snapshot?.snapshot.expectedReturn),
      performanceFee: Number(snapshot?.snapshot.performanceFee),
      creditAvailable: BigInt(snapshot?.snapshot.creditAvailable),
      debtOutstanding: BigInt(snapshot?.snapshot.debtOutstanding),
      DOMAIN_SEPARATOR: snapshot?.snapshot.DOMAIN_SEPARATOR,
      emergencyShutdown: snapshot?.snapshot.emergencyShutdown,
      maxAvailableShares: BigInt(snapshot?.snapshot.maxAvailableShares),
      availableDepositLimit: BigInt(snapshot?.snapshot.availableDepositLimit),
      lockedProfitDegradation: BigInt(snapshot?.snapshot.lockedProfitDegradation)
    }
  }))

  const forwardAPY = await computeChainAPY(vault, 1, strategiesWithIndicators)

  if(forwardAPY) {
    console.log({
      forwardAPY
    })
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
