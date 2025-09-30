import chains from '@/chains'
import { z } from 'zod'

const LatestBlockSchema = z.object({
  chainId: z.number(),
  blockNumber: z.bigint({ coerce: true }),
})

export const SparklinePointSchema = z.object({
  close: z.number(),
  blockTime: z.bigint({ coerce: true })
})

export const VaultSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  name: z.string(),
  apiVersion: z.string(),
  sparklines: z.object({
    tvl: z.array(SparklinePointSchema).default([]),
    apy: z.array(SparklinePointSchema).default([])
  })
})

const QueueSchema = z.object({
  name: z.string(),
  waiting: z.number(),
  active: z.number(),
  failed: z.number()
})

const DbSchema = z.object({
  databaseSize: z.number({ coerce: true }),
  indexHitRate: z.number({ coerce: true }),
  cacheHitRate: z.number({ coerce: true }),
  clients: z.number({ coerce: true })
})

const MemorySchema = z.object({
  total: z.number({ coerce: true }),
  used: z.number({ coerce: true })
})

const RedisSchema = z.object({
  uptime: z.number({ coerce: true }),
  clients: z.number({ coerce: true }),
  memory: MemorySchema
})

const CpuSchema = z.object({
  usage: z.number({ coerce: true })
})

const IngestSchema = z.object({
  cpu: CpuSchema,
  memory: MemorySchema
})

const MonitorSchema = z.object({
  queues: z.array(QueueSchema).default([]),
  db: DbSchema,
  redis: RedisSchema,
  ingest: IngestSchema,
  indexStatsJson: z.string()
})

type Monitor = z.infer<typeof MonitorSchema>

export const OutputSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  label: z.string(),
  component: z.string().nullish(),
  value: z.number(),
  period: z.string(),
  time: z.bigint({ coerce: true })
})

export const DataContextSchema = z.object({
  latestBlocks: z.array(LatestBlockSchema),
  monitor: MonitorSchema
})

export type DataContext = z.infer<typeof DataContextSchema>

export const DEFAULT_CONTEXT = {
  latestBlocks: [],
  monitor: {
    queues: [
      { name: 'fanout', waiting: 0, active: 0, failed: 0 },
      { name: 'extract', waiting: 0, active: 0, failed: 0 },
      ...chains.map(chain => ({
        name: `extract-${chain.id}`,
        waiting: 0,
        active: 0,
        failed: 0
      })),
      { name: 'load', waiting: 0, active: 0, failed: 0 }
    ],
    db: {
      databaseSize: 0,
      indexHitRate: 0,
      cacheHitRate: 0,
      clients: 0
    },
    redis: {
      uptime: 0,
      clients: 0,
      memory: {
        total: 0,
        used: 0
      }
    },
    ingest: {
      cpu: {
        usage: 0
      },
      memory: {
        total: 0,
        used: 0
      }
    },
    indexStatsJson: `{
      "thing_total": 0,
      "thing_vault_total": 0,
      "thing_strategy_total": 0,
      "thing_erc20_total": 0,
      "thing_debtAllocator_total": 0,
      "thing_accountant_total": 0,
      "thing_tradeHandler_total": 0,
      "output_total": 0,
      "evmlog_total": 0,
      "eventCounts": []
    }`
  } as Monitor
} as DataContext
