import { StrategyWithIndicators } from '../types'
import { getSnapshot } from './snapshot'
import { getThingWithName } from './thing'

export async function getFullStrategy(chainId: number, address: `0x${string}`) {
  const strategy = await getThingWithName(chainId, address, 'strategy')
  const snapshot = await getSnapshot(chainId, address, 'strategy')

  return {
    ...strategy,
    ...snapshot?.snapshot,
    name: snapshot?.snapshot.name,
    token: snapshot?.snapshot.token,
    symbol: snapshot?.snapshot.symbol,
    rewards: snapshot?.snapshot.rewards,
    guardian: snapshot?.snapshot.guardian,
    blockTime: Number(snapshot?.snapshot.blockTime),
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
    localKeepCRV: BigInt(snapshot?.snapshot.localKeepCRV),
    apiVersion: snapshot?.snapshot.apiVersion
  }

}

export async function getVaultStrategies(chainId: number, address: `0x${string}`): Promise<StrategyWithIndicators[]> {
  const snapshot = await getSnapshot(chainId, address, 'vault')
  const strategies = snapshot?.snapshot.hook.withdrawalQueue ?? snapshot?.snapshot.hook.strategies
  return Promise.all(strategies.map(async (address: `0x${string}`) => {
    return getFullStrategy(chainId, address)
  }))
}
