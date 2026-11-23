import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CRON_JOBS, runCronJobs } from './cron-triggers'

describe('runCronJobs', () => {
  it('calls every job of the cron with the cron secret', async () => {
    const fetch = vi.fn(async (_request: Request) => new Response('{}'))

    await runCronJobs('*/30 * * * *', 'secret', fetch)

    assert.deepEqual(
      fetch.mock.calls.map(([request]) => [new URL(request.url).pathname, request.headers.get('authorization')]),
      [['/api/cron/refresh-cache', 'Bearer secret'], ['/api/cron/tvl-refresh', 'Bearer secret']],
    )
  })

  it('runs nothing for an unknown cron', async () => {
    const fetch = vi.fn(async (_request: Request) => new Response('{}'))

    await runCronJobs('1 1 1 1 1', 'secret', fetch)

    assert.equal(fetch.mock.calls.length, 0)
  })

  it('covers the same paths and schedules as vercel.json', () => {
    const vercel = JSON.parse(readFileSync(path.join(__dirname, 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string, schedule: string }>
    }
    const fromVercel = vercel.crons.map(({ path, schedule }) => `${schedule} ${path}`).sort()
    const fromWorker = Object.entries(CRON_JOBS)
      .flatMap(([cron, jobs]) => jobs.map((job) => `${cron} /api/cron/${job}`))
      .sort()
    assert.deepEqual(fromWorker, fromVercel)
  })
})
