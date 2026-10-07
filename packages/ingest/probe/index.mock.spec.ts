import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../db', () => ({ default: { query: queryMock } }))
vi.mock('lib', () => ({ chains: [], mq: {} }))
vi.mock('lib/processor', () => ({}))
vi.mock('bullmq', () => ({}))

import Probe from './index'

describe('probe/db cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    queryMock.mockReset()
    queryMock.mockResolvedValue({ rows: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('hits the db once within 60s and again after', async () => {
    const probe = new Probe() as any
    await probe.probeDbCached()
    const calls = queryMock.mock.calls.length
    expect(calls).toBeGreaterThan(0)

    vi.advanceTimersByTime(59_000)
    await probe.probeDbCached()
    expect(queryMock).toHaveBeenCalledTimes(calls)

    vi.advanceTimersByTime(2_000)
    await probe.probeDbCached()
    expect(queryMock.mock.calls.length).toBeGreaterThan(calls)
  })
})
