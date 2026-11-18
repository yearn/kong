import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

const { since } = vi.hoisted(() => ({ since: vi.fn() }))
vi.mock('./db', () => ({ getTimeseriesSince: since }))
import { refreshHistoricalSeries } from './historical'

const DAY = 86400
const now = 500 * DAY + 3600
const cutoff = 136 * DAY
const pool = {} as Pool
const old = { time: 200 * DAY, component: 'tvl', value: 10 }
const corrected = { time: 498 * DAY, component: 'tvl', value: 20 }
const removed = { time: 499 * DAY, component: 'tvl', value: 30 }
const cached = (refreshedAt = now - DAY, reconciledAt = now - DAY) => JSON.stringify({
  value: [old, corrected, removed], refreshedAt, reconciledAt,
})
const refresh = (value: string | null, force = false) =>
  refreshHistoricalSeries(1, '0x1', 'tvl-c', value, now, force, pool)

describe('incremental historical timeseries', () => {
  beforeEach(() => {
    since.mockReset().mockResolvedValue([])
  })

  it.each([null, '{invalid', JSON.stringify({ value: [old] })])('rebuilds missing, invalid and legacy entries', async value => {
    const result = await refresh(value)
    expect(result.full).toBe(true)
    expect(since).toHaveBeenCalledWith(1, '0x1', 'tvl-c', cutoff, pool)
    expect(JSON.parse(result.payload)).toEqual({ value: [], refreshedAt: now, reconciledAt: now })
  })

  it('preserves older history, replaces corrections and removes newly null buckets', async () => {
    since.mockResolvedValue([{ ...corrected, time: BigInt(corrected.time), value: 25 }])
    const result = await refresh(cached())
    expect(result.full).toBe(false)
    expect(since).toHaveBeenCalledWith(1, '0x1', 'tvl-c', 497 * DAY, pool)
    expect(JSON.parse(result.payload)).toEqual({
      value: [old, { ...corrected, value: 25 }], refreshedAt: now, reconciledAt: now - DAY,
    })
  })

  it('prunes expired cached days and retains the first day in the window', async () => {
    const firstDay = { ...old, time: cutoff }
    const value = JSON.stringify({
      value: [{ ...old, time: cutoff - DAY }, firstDay], refreshedAt: now - DAY, reconciledAt: now - DAY,
    })
    expect(JSON.parse((await refresh(value)).payload).value).toEqual([firstDay])
  })

  it('includes missed refresh days in the query window', async () => {
    await refresh(cached(now - 4 * DAY, now - 5 * DAY))
    expect(since).toHaveBeenCalledWith(1, '0x1', 'tvl-c', 494 * DAY, pool)
  })

  it('retains Postgres numeric strings without triggering full rebuilds', async () => {
    const value = JSON.stringify({
      value: [{ ...old, value: '123.456' }], refreshedAt: now - DAY, reconciledAt: now - DAY,
    })
    const result = await refresh(value)
    expect(result.full).toBe(false)
    expect(JSON.parse(result.payload).value).toEqual([{ ...old, value: '123.456' }])
  })

  it('reconciles old backfills weekly and supports a forced rebuild', async () => {
    expect((await refresh(cached(now - DAY, now - 7 * DAY))).full).toBe(true)
    expect((await refresh(cached(), true)).full).toBe(true)
    expect(since.mock.calls.map(args => args[3])).toEqual([cutoff, cutoff])
  })
})
