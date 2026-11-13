import type { JobName, RefreshJob } from '../job-types'
import { refreshCache } from './refresh-cache'
import { refreshTvl } from './tvl-refresh'
import { refreshTimeseries } from './timeseries-refresh'
import { refreshHistoricalTimeseries } from './timeseries-refresh-historical'
import { refreshReports } from './reports-refresh'
import { refreshHistoricalReports } from './reports-refresh-historical'

const jobs: Record<JobName, RefreshJob> = {
  'refresh-cache': refreshCache,
  'tvl-refresh': refreshTvl,
  'timeseries-refresh': refreshTimeseries,
  'timeseries-refresh-historical': refreshHistoricalTimeseries,
  'reports-refresh': refreshReports,
  'reports-refresh-historical': refreshHistoricalReports,
}

export function getRefreshJob(job: JobName): RefreshJob {
  return jobs[job]
}

export { refreshCache, refreshTvl, refreshTimeseries, refreshHistoricalTimeseries, refreshReports, refreshHistoricalReports }
