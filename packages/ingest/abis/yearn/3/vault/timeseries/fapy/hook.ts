import { Output, OutputSchema, SnapshotSchema, StrategySchema, StrategyThing, VaultThingsWithName, VaultThingsWithNameSchema } from 'lib/types'
import { Data } from '../../../../../../extract/timeseries'
import { first, query } from '../../../../../../db'
import { computeChainAPY } from '../../../../../../forward'
import { multicall3 } from 'lib'
import { getBlock, estimateHeight } from 'lib/blocks'

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

  const vault = await first<VaultThingsWithName>(VaultThingsWithNameSchema,
    `select thing.*, snapshot.snapshot->>'name' as name
      from thing
      join snapshot on thing.chain_id = snapshot.chain_id and thing.address = snapshot.address
      where thing.chain_id = $1 AND thing.address = $2 AND thing.label = $3 AND (thing.defaults->>'yearn')::boolean = true`,
    [chainId, address, 'vault']
  )

  if (!vault) return []

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
    const strategySnapshot = await first(SnapshotSchema, `
      SELECT *
      FROM snapshot
      WHERE address = $1
    `, [strategy.address])

    return {
      ...strategy,
      ...strategySnapshot?.snapshot,
      name: strategySnapshot?.snapshot.name,
      token: strategySnapshot?.snapshot.token,
      symbol: strategySnapshot?.snapshot.symbol,
      rewards: strategySnapshot?.snapshot.rewards,
      guardian: strategySnapshot?.snapshot.guardian,
      blockTime: Number(strategySnapshot?.snapshot.blockTime),
      totalDebt: BigInt(snapshot?.snapshot.totalDebt),
      totalIdle: BigInt(snapshot?.snapshot.totalIdle),
      debtRatio: Number(snapshot?.snapshot.debtRatio),
      decimals: Number(snapshot?.snapshot.decimals),
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
      lockedProfitDegradation: BigInt(snapshot?.snapshot.lockedProfitDegradation),
      localKeepCRV: BigInt(strategySnapshot?.snapshot.localKeepCRV),
      apiVersion: strategySnapshot?.snapshot.apiVersion
    }
  }))

  const vaultAPY = await computeChainAPY(vault, 1, strategiesWithIndicators)

  if(vaultAPY) {
    return OutputSchema.array().parse([
      {
        chainId, address, label: data.outputLabel, component: 'vaultAPRType',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.type
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPointsWeekAgo',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.points?.weekAgo
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPointsMonthAgo',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.points?.monthAgo
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPointsInception',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.points?.inception
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPricePerShareToday',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.pricePerShare?.today
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPricePerShareWeekAgo',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.pricePerShare?.weekAgo
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultPricePerShareMonthAgo',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.pricePerShare?.monthAgo
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultFeesPerformance',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.fees?.performance
      },
      {
        chainId, address, label: data.outputLabel, component: 'vaultFeesManagement',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.fees?.management
      },
      {
        chainId, address, label: data.outputLabel, component: 'forwardAPRType',
        blockNumber, blockTime: data.blockTime, value: vaultAPY.forwardAPY?.type
      },
      {
        chainId, address, label: data.outputLabel, component: 'forwardNetAPY',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.netAPY)
      }, {
        chainId, address, label: data.outputLabel, component: 'forwardBoost',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.boost)
      }, {
        chainId, address, label: data.outputLabel, component: 'poolAPY',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.poolAPY)
      }, {
        chainId, address, label: data.outputLabel, component: 'boostedAPR',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.boostedAPR)
      }, {
        chainId, address, label: data.outputLabel, component: 'baseAPR',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.baseAPR)
      }, {
        chainId, address, label: data.outputLabel, component: 'rewardsAPY',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.rewardsAPY)
      }, {
        chainId, address, label: data.outputLabel, component: 'cvxAPR',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.cvxAPR)
      }, {
        chainId, address, label: data.outputLabel, component: 'keepCRV',
        blockNumber, blockTime: data.blockTime, value: Number(vaultAPY.forwardAPY?.keepCRV)
      }])
  }

  return []
}
