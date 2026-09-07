import { refreshLatest } from '../../rest/timeseries/refresh'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createCronHandler(refreshLatest, 'UPTIME_KUMA_PUSH_URL_TIMESERIES_REFRESH')
