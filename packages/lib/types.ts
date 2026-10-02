import { getAddress } from 'viem'
import { z } from 'zod'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zhexstring = z.custom<`0x${string}`>((val: any) => /^0x/.test(val))
export const EvmAddressSchema = zhexstring.refine(s => /^0x[0-9a-fA-F]{40}$/.test(s)).transform(s => getAddress(s))
export type EvmAddress = z.infer<typeof EvmAddressSchema>

export function compareEvmAddresses(a?: string, b?: string) {
  if (!a || !b) return false

  try {
    return EvmAddressSchema.parse(getAddress(a)) === EvmAddressSchema.parse(getAddress(b))
  } catch {
    return false
  }
}
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
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
  type: z.string().optional(),
  icon: z.string().optional(),
  address: AddressSchema.optional(),
  chainId: z.number().int().positive().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
  decimals: z.number().int().min(0).max(255).optional(),
  displayName: z.string().optional(),
  displaySymbol: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
})

export type TokenMeta = z.infer<typeof TokenMetaSchema>

export const VaultMetaSchema = z.object({
  chainId: z.number(),
  address: AddressSchema,
  name: z.string(),
  registry: AddressSchema.optional(),
  type: z.string(),
  kind: z.string(),
  isRetired: z.boolean(),
  isHidden: z.boolean(),
  shouldDisableStaking: z.boolean().optional(),
  isAggregator: z.boolean(),
  isBoosted: z.boolean(),
  isAutomated: z.boolean(),
  isHighlighted: z.boolean(),
  isPool: z.boolean(),
  shouldUseV2APR: z.boolean(),
  migration: z.object({
    available: z.boolean(),
    target: AddressSchema.optional(),
    contract: AddressSchema.optional(),
  }),
  stability: z.object({
    stability: z.string(),
    stableBaseAsset: z.string().optional(),
  }),
  category: z.string().optional(),
  displayName: z.string().optional(),
  displaySymbol: z.string().optional(),
  description: z.string().optional(),
  sourceURI: z.string().optional(),
  uiNotice: z.string().optional(),
  protocols: z.array(z.string()),
  inclusion: z.object({
    isSet: z.boolean(),
    isYearn: z.boolean(),
    isYearnJuiced: z.boolean(),
    isGimme: z.boolean(),
    isPoolTogether: z.boolean(),
    isCove: z.boolean(),
    isMorpho: z.boolean(),
    isKatana: z.boolean(),
    isPublicERC4626: z.boolean(),
  }),
})

export type VaultMeta = z.infer<typeof VaultMetaSchema>

export const StrategyMetaSchema = z.object({
  chainId: z.number(),
  address: AddressSchema,
  name: z.string(),
  isRetired: z.boolean().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  protocols: z.array(
    z.string()
  ),
})

export type StrategyMeta = z.infer<typeof StrategyMetaSchema>

export const OutputSchema = z.object({
  chainId: z.number(),
  address: EvmAddressSchema,
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

export const EstimatedAprSchema = z.object({
  apr: z.number().optional(),
  apy: z.number().optional(),
  type: z.string(),
  components: z.record(z.string(), z.number().nullish())
})

export type EstimatedApr = z.infer<typeof EstimatedAprSchema>
