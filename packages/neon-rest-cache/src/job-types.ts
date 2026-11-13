import type { Pool } from 'pg'

export type CacheSetOptions = { atomic?: boolean }

export type JobCache = {
  getMany(keys: string[]): Promise<Array<string | null>>
  setMany(pairs: Array<[string, string]>, options?: CacheSetOptions): Promise<void>
}

/** Dependencies supplied by the worker runtime to each cache refresh job. */
export type JobContext = {
  sourceDb: Pool
  cache: JobCache
  now?: Date
  historicalFullRefresh?: boolean
}

export type JobName =
  | 'refresh-cache'
  | 'tvl-refresh'
  | 'timeseries-refresh'
  | 'timeseries-refresh-historical'
  | 'reports-refresh'
  | 'reports-refresh-historical'

export type RefreshJob = (context: JobContext) => Promise<void>
