import { refreshHistorical } from '../../rest/reports/refresh-historical'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 800

// Manual-trigger only, matching the workflow_dispatch-only job it replaces:
// no entry in vercel.json crons, invoked with an authenticated request.
export const GET = createCronHandler(refreshHistorical, 'UPTIME_KUMA_PUSH_URL_REPORTS_HISTORICAL')
