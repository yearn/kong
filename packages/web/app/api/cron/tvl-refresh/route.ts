import { refresh } from '../../rest/tvl/refresh'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createCronHandler(refresh, 'UPTIME_KUMA_PUSH_URL_TVL_REFRESH')
