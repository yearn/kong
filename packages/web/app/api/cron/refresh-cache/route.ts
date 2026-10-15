import { refresh } from '../../rest/refresh-vaults'
import { refreshTranches } from '../../rest/tranche/refresh'
import { createCronHandler } from '../handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createCronHandler(async () => {
  await Promise.all([refresh(), refreshTranches()])
}, 'UPTIME_KUMA_PUSH_URL_REFRESH_VAULTS')
