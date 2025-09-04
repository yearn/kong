import { getAddress } from 'viem'
import { z } from 'zod'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zhexstring = z.custom<`0x${string}`>((val: any) => /^0x/.test(val))
export const zvaultType = z.enum(['vault', 'strategy'])
export type HexString = z.infer<typeof zhexstring>

export const EvmAddressSchema = zhexstring.transform(s => getAddress(s))
export type EvmAddress = z.infer<typeof EvmAddressSchema>

export function compareEvmAddresses(a?: string, b?: string) {
  if (!a || !b) return false

  try {
    return EvmAddressSchema.parse(getAddress(a)) === EvmAddressSchema.parse(getAddress(b))
  } catch {
    return false
  }
}

export const JobSchema = z.object({
  queue: z.string(),
  name: z.string(),
  bychain: z.boolean().default(false).optional()
})

export type Job = z.infer<typeof JobSchema>

export const Erc20Schema = z.object({
  chainId: z.number(),
  address: zhexstring,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number({ coerce: true })
})

export type Erc20 = z.infer<typeof Erc20Schema>

export interface LatestBlock {
  chainId: number
  blockNumber: bigint
  blockTime: bigint
}

export interface APR {
  chainId: number
  address: string
  gross: number
  net: number
  blockNumber: bigint
  blockTime: bigint
}

export const APYSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  weeklyNet: z.number().nullish(),
  weeklyPricePerShare: z.bigint({ coerce: true }).nullish(),
  weeklyBlockNumber: z.bigint({ coerce: true }),
  monthlyNet: z.number().nullish(),
  monthlyPricePerShare: z.bigint({ coerce: true }).nullish(),
  monthlyBlockNumber: z.bigint({ coerce: true }),
  inceptionNet: z.number(),
  inceptionPricePerShare: z.bigint({ coerce: true }),
  inceptionBlockNumber: z.bigint({ coerce: true }),
  net: z.number(),
  grossApr: z.number(),
  pricePerShare: z.bigint({ coerce: true }),
  lockedProfit: z.bigint({ coerce: true }).nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type APY = z.infer<typeof APYSchema>

export const TVLSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  priceUsd: z.number(),
  priceSource: z.string(),
  tvlUsd: z.number(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type TVL = z.infer<typeof TVLSchema>

export const VaultSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  type: zvaultType.nullish(),
  apiVersion: z.string().nullish(),
  apetaxType: z.string().nullish(),
  apetaxStatus: z.string().nullish(),
  registryStatus: z.string().nullish(),
  registryAddress: zhexstring.nullish(),
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  decimals: z.number().nullish(),
  assetAddress: zhexstring.nullish(),
  assetName: z.string().nullish(),
  assetSymbol: z.string().nullish(),
  totalAssets: z.bigint({ coerce: true }).nullish(),
  totalDebt: z.bigint({ coerce: true }).nullish(),
  totalIdle: z.bigint({ coerce: true }).nullish(),
  minimumTotalIdle: z.bigint({ coerce: true }).nullish(),
  debtRatio: z.number().nullish(),
  availableDepositLimit: z.bigint({ coerce: true }).nullish(),
  depositLimit: z.bigint({ coerce: true }).nullish(),
  governance: zhexstring.nullish(),
  performanceFee: z.number().nullish(),
  managementFee: z.number().nullish(),
  lockedProfitDegradation: z.bigint({ coerce: true }).nullish(),
  profitMaxUnlockTime: z.bigint({ coerce: true }).nullish(),
  profitUnlockingRate: z.bigint({ coerce: true }).nullish(),
  fullProfitUnlockDate: z.bigint({ coerce: true }).nullish(),
  lastProfitUpdate: z.bigint({ coerce: true }).nullish(),
  accountant: zhexstring.nullish(),
  roleManager: zhexstring.nullish(),
  debtManager: zhexstring.nullish(),
  keeper: zhexstring.nullish(),
  doHealthCheck: z.boolean().nullish(),
  emergencyShutdown: z.boolean().nullish(),
  isShutdown: z.boolean().nullish(),
  activationBlockTime: z.bigint({ coerce: true }).nullish(),
  activationBlockNumber: z.bigint({ coerce: true }).nullish(),
  __as_of_block: z.bigint({ coerce: true }).nullish()
})

export type Vault = z.infer<typeof VaultSchema>

export interface Strategy {
  chainId: number
  address: `0x${string}`
  vaultAddress: `0x${string}`,
  apiVersion?: string
  name?: string,
  assetAddress?: `0x${string}`
  estimatedTotalAssets?: bigint,
  delegatedAssets?: bigint,
  performanceFee?: number,
  debtRatio?: number,
  minDebtPerHarvest?: bigint,
  maxDebtPerHarvest?: bigint,
  lastReportBlockTime?: bigint,
  totalDebt?: bigint,
  totalDebtUsd?: number,
  totalGain?: bigint,
  totalLoss?: bigint,
  withdrawalQueueIndex?: number,
  migrateAddress?: `0x${string}`,
  strategist?: `0x${string}`,
  keeper?: `0x${string}`,
  healthCheck?: `0x${string}`,
  doHealthCheck?: boolean,
  tradeFactory?: `0x${string}`,
  activationBlockTime?: bigint,
  activationBlockNumber?: bigint,
  __as_of_block?: bigint
}

export interface StrategyLenderStatus {
  chainId: number
  strategyAddress: `0x${string}`
  name: string
  assets: bigint
  rate: number
  address: `0x${string}`
  __as_of_block: bigint
}

export interface WithdrawalQueueItem {
  chainId: number
  vaultAddress: `0x${string}`
  queueIndex: number
  strategyAddress?: `0x${string}`
  __as_of_block?: bigint
}

export interface Transfer {
  chainId: number
  address: `0x${string}`
  sender: `0x${string}`
  receiver: `0x${string}`
  amount: string
  amountUsd?: number
  blockNumber: string
  blockIndex: number
  blockTime: string
  transactionHash: `0x${string}`
}

export const RiskScoreSchema = z.object({
  riskLevel: z.number(),
  riskScore: z.object({
    review: z.number(),
    testing: z.number(),
    complexity: z.number(),
    riskExposure: z.number(),
    protocolIntegration: z.number(),
    centralizationRisk: z.number(),
    externalProtocolAudit: z.number(),
    externalProtocolCentralisation: z.number(),
    externalProtocolTvl: z.number(),
    externalProtocolLongevity: z.number(),
    externalProtocolType: z.number(),
    comment: z.string().optional()
  })
})

export type RiskScore = z.infer<typeof RiskScoreSchema>

export const DefaultRiskScore = RiskScoreSchema.parse({
  riskLevel: 0,
  riskScore: {
    review: 0,
    testing: 0,
    complexity: 0,
    riskExposure: 0,
    protocolIntegration: 0,
    centralizationRisk: 0,
    externalProtocolAudit: 0,
    externalProtocolCentralisation: 0,
    externalProtocolTvl: 0,
    externalProtocolLongevity: 0,
    externalProtocolType: 0,
    comment: 'unrated'
  }
})

export const TokenMetaSchema = z.object({
  type: z.string(),
  category: z.string(),
  description: z.string(),
  displayName: z.string(),
  displaySymbol: z.string(),
  icon: z.string()
})

export type TokenMeta = z.infer<typeof TokenMetaSchema>

export const VaultMetaSchema = z.object({
  displayName: z.string(),
  displaySymbol: z.string(),
  description: z.string(),
  protocols: z.string().array().nullish()
})

export type VaultMeta = z.infer<typeof VaultMetaSchema>

export const StrategyMetaSchema = z.object({
  displayName: z.string(),
  description: z.string(),
  protocols: z.string().array().transform(v => v ? v : []).nullish()
})

export type StrategyMeta = z.infer<typeof StrategyMetaSchema>

export const HarvestSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  profit: z.bigint({ coerce: true }),
  profitUsd: z.number({ coerce: true }).nullish(),
  loss: z.bigint({ coerce: true }),
  lossUsd: z.number({ coerce: true }).nullish(),
  totalProfit: z.bigint({ coerce: true }).nullish(),
  totalProfitUsd: z.number({ coerce: true }).nullish(),
  totalLoss: z.bigint({ coerce: true }).nullish(),
  totalLossUsd: z.number({ coerce: true }).nullish(),
  totalDebt: z.bigint({ coerce: true }).nullish(),
  protocolFees: z.bigint({ coerce: true }).nullish(),
  protocolFeesUsd: z.number({ coerce: true }).nullish(),
  performanceFees: z.bigint({ coerce: true }).nullish(),
  performanceFeesUsd: z.number({ coerce: true }).nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockIndex: z.number({ coerce: true }),
  blockTime: z.bigint({ coerce: true }).nullish(),
  transactionHash: zhexstring
})

export type Harvest = z.infer<typeof HarvestSchema>

export interface SparklinePoint {
  chainId: number
  address: `0x${string}`
  type: string
  value: number
  time: string
}

export const VaultDebtSchema = z.object({
  chainId: z.number(),
  lender: zhexstring,
  borrower: zhexstring,
  maxDebt: z.bigint({ coerce: true }),
  currentDebt: z.bigint({ coerce: true }),
  currentDebtRatio: z.number({ coerce: true }),
  targetDebtRatio: z.number({ coerce: true }).nullish(),
  maxDebtRatio: z.number({ coerce: true }).nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type VaultDebt = z.infer<typeof VaultDebtSchema>

export const OutputSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  label: z.string(),
  component: z.string().nullish(),
  value: z.any().transform(val => {
    const result = z.number().safeParse(val)
    if(result.success && isFinite(result.data)) return result.data
    return undefined
  }).nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type Output = z.infer<typeof OutputSchema>

export const EvmLogSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  eventName: z.string(),
  signature: zhexstring,
  topics: zhexstring.array(),
  args: z.record(z.any()),
  hook: z.record(z.any()),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  logIndex: z.number(),
  transactionHash: zhexstring,
  transactionIndex: z.number()
})

export type EvmLog = z.infer<typeof EvmLogSchema>

export const StrideSchema = z.object({
  from: z.bigint({ coerce: true }),
  to: z.bigint({ coerce: true })
})

export type Stride = z.infer<typeof StrideSchema>

export const ThingSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  label: z.string(),
  defaults: z.record(z.any())
})

export type Thing = z.infer<typeof ThingSchema>

export const SnapshotSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  snapshot: z.record(z.any()),
  hook: z.record(z.any()),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type Snapshot = z.infer<typeof SnapshotSchema>

export const PriceSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  priceUsd: z.number({ coerce: true }),
  priceSource: z.string(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
})

export type Price = z.infer<typeof PriceSchema>

export const TradeableSchema = z.object({
  strategy: zhexstring,
  token: zhexstring,
  name: z.string(),
  symbol: z.string(),
  decimals: z.bigint({ coerce: true })
})

export type Tradeable = z.infer<typeof TradeableSchema>

export const InceptSchema = z.object({
  inceptBlock: z.bigint({ coerce: true }),
  inceptTime: z.bigint({ coerce: true })
})

export type Incept = z.infer<typeof InceptSchema>
