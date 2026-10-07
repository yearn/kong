import { afterEach, describe, expect, it, vi } from 'vitest'
const { count, captureException } = vi.hoisted(() => ({ count: vi.fn(), captureException: vi.fn() }))
vi.mock('bullmq', () => ({
  Queue: class { count = count; close = vi.fn() },
  Worker: class { concurrency = 1; close = vi.fn() }
}))
vi.mock('../lib/chains', () => ({ default: [] }))
vi.mock('../lib/sentry', () => ({ captureException, countMetric: vi.fn(), flush: vi.fn() }))
import { worker } from '../lib/mq'
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe('worker concurrency probe', () => {
  it('throttles alternating failures and successes to one alert per minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let calls = 0
    count.mockImplementation(async () => {
      if (++calls % 2) throw new Error('flapping Redis')
      return 0
    })
    const instance = worker('extract', async () => {})
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(captureException).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(captureException).toHaveBeenCalledTimes(2)
    } finally { await instance.close() }
  })
  it('does not start another count while the previous probe is pending', async () => {
    vi.useFakeTimers()
    let resolve!: (value: number) => void
    count.mockImplementation(() => new Promise<number>(done => { resolve = done }))
    const instance = worker('extract', async () => {})
    try {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(count).toHaveBeenCalledTimes(1)
      resolve(0)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(count).toHaveBeenCalledTimes(2)
      resolve(0)
    } finally { await instance.close() }
  })
})
