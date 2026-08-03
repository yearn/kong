import { refreshHistorical } from '../../rest/timeseries/refresh-historical'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 800

// Full-history rebuild of every vault × label does not fit one invocation, so it
// runs hourly and covers 1/24 of the vaults each tick — every vault still gets a
// full refresh once per day, the cadence the deleted workflow provided.
export const SHARD_TOTAL = 24

export const GET = createCronHandler(
  () => refreshHistorical({ index: new Date().getUTCHours() % SHARD_TOTAL, total: SHARD_TOTAL }),
  'UPTIME_KUMA_PUSH_URL_TIMESERIES_HISTORICAL',
)
