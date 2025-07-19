import { StrategyWithIndicators } from '../types'
import { getSnapshot } from './snapshot'
import { getThing } from './thing'

export async function getFullStrategy({
  chainId,
  address,
  vaultAddress
}:{
  chainId: number,
  address: `0x${string}`,
  vaultAddress: `0x${string}`
}) {
  const [strategy, strategySnapshot, snapshot] = await Promise.all([
    getThing(chainId, address, 'strategy'),
    getSnapshot(chainId, address),
    getSnapshot(chainId, vaultAddress)
  ])

  return  {
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

}

export async function getVaultStrategies(chainId: number, address: `0x${string}`): Promise<StrategyWithIndicators[]> {
  const snapshot = await getSnapshot(chainId, address)
  const strategies = snapshot?.hook?.withdrawalQueue ?? snapshot?.hook?.strategies
  return Promise.all(strategies.map(async (strategyAddress: `0x${string}`) => {
    return getFullStrategy({ chainId, address: strategyAddress, vaultAddress: address })
  }))
}
