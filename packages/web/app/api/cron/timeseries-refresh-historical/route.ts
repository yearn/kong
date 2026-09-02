import { refreshHistorical } from '../../rest/timeseries/refresh-historical'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 800

export const GET = createCronHandler(refreshHistorical, 'UPTIME_KUMA_PUSH_URL_TIMESERIES_HISTORICAL')
