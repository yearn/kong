export const CRON_JOBS: Record<string, string[]> = {
  '*/30 * * * *': ['refresh-cache', 'tvl-refresh'],
  '0 * * * *': ['timeseries-refresh'],
  '15 2 * * *': ['timeseries-refresh-historical'],
}

export function runCronJobs(cron: string, secret: string | undefined, fetch: (request: Request) => Promise<Response>) {
  return Promise.all((CRON_JOBS[cron] ?? []).map(async (job) => {
    const response = await fetch(new Request(`https://kong.yearn.fi/api/cron/${job}`, {
      headers: { authorization: `Bearer ${secret}` },
    }))
    if (!response.ok) console.error(`scheduled ${job} failed: ${response.status}`)
  }))
}
