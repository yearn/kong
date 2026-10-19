import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Keyv } from 'keyv'
import type { Pool } from 'pg'
import { labels } from './labels'
import { getTimeseriesKey, getTimeseriesLatestKey } from './redis'

const state = vi.hoisted(() => ({
  raw: new Map<string, string>(), get: vi.fn(), full: vi.fn(), since: vi.fn(), failWrite: false,
  vaults: vi.fn(), tranches: vi.fn(), controllers: vi.fn(), pool: {},
}))
vi.mock('./db', () => ({
  getFullTimeseries: state.full, getTimeseriesSince: state.since,
  getVaults: state.vaults, getTranches: state.tranches, getTrancheControllers: state.controllers,
}))
vi.mock('../../db/cron', () => ({ cronDb: state.pool }))
vi.mock('../cache', () => ({
  getKeyvClient: () => ({ get: state.get }), lastRefreshHeaders: async () => ({}),
  cacheMGet: async (keys: string[]) => keys.map(key => state.raw.get(key) ?? null),
  cacheMSet: async (pairs: [string, string][]) => {
    if (state.failWrite) throw new Error('Redis write failed')
    for (const [k, v] of pairs) state.raw.set(k, v)
  },
}))
import { refreshHistoricalSeries } from './historical'
import { refreshHistorical } from './refresh-historical'
import { GET } from './[segment]/[chainId]/[address]/route'

const DAY = 86400
const now = 100 * DAY + 3600
const address = '0x1111111111111111111111111111111111111111'
const pool = state.pool as Pool
const readResponse = async (segment: string, components = '') => {
  const response = await GET(new Request(`http://localhost/api/rest/timeseries/${segment}/1/${address}${components}`) as never,
    { params: Promise.resolve({ segment, chainId: '1', address }) })
  expect(response.status).toBe(200)
  return response.json()
}

describe('serialized historical cache to REST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.raw.clear()
    state.failWrite = false
    const keyv = new Keyv({ store: state.raw, useKeyPrefix: false })
    state.get.mockImplementation((key: string) => keyv.get(key))
    state.full.mockResolvedValue([])
    state.since.mockResolvedValue([])
    state.vaults.mockResolvedValue([{ chainId: 1, address }])
    state.tranches.mockResolvedValue([{ chainId: 1, address }])
    state.controllers.mockResolvedValue([{ chainId: 1, address }])
  })

  it.each(labels)('keeps the $segment response compatible through full and incremental refresh', async ({ label, segment, defaultComponent }) => {
    const older = { time: BigInt(10 * DAY), component: defaultComponent, value: '12345678901234567890.1234567890' }
    const correction = { time: BigInt(98 * DAY), component: defaultComponent, value: '42.000' }
    const extra = { time: BigInt(98 * DAY), component: 'extra-component', value: '0' }
    const rows = [older, correction, extra]
    state.full.mockResolvedValue(rows)
    const key = getTimeseriesKey(label, 1, address)
    // Exact pre-PR serialization, then actual Keyv deserialization + HTTP handler.
    state.raw.set(key, JSON.stringify({ value: rows.map(row => ({ time: Number(row.time), component: row.component, value: row.value })) }))
    const baseline = await readResponse(segment, `?components=${defaultComponent}&components=extra-component`)
    const cold = await refreshHistoricalSeries(1, address, label, state.raw.get(key)!, now - DAY, false, pool)
    state.raw.set(key, cold.payload)
    expect(await readResponse(segment, `?components=${defaultComponent}&components=extra-component`)).toEqual(baseline)
    state.since.mockResolvedValue([correction, extra])
    const warm = await refreshHistoricalSeries(1, address, label, cold.payload, now, false, pool)
    state.raw.set(key, warm.payload)
    const warmResponse = await readResponse(segment)
    expect(warmResponse).toEqual(baseline.filter((row: { component: string }) => row.component === defaultComponent))
    expect(warmResponse.every((row: object) => Object.keys(row).sort().join() === 'component,time,value')).toBe(true)
    expect(warmResponse.every((row: { value: unknown }) => typeof row.value === 'string')).toBe(true)
    const warmMulti = await readResponse(segment, `?components=${defaultComponent}&components=extra-component`)
    const canonical = (rows: { time: number; component: string }[]) => [...rows].sort((a, b) => a.time - b.time || a.component.localeCompare(b.component))
    expect(canonical(warmMulti)).toEqual(canonical(baseline))
    state.raw.set(getTimeseriesLatestKey(label, 1, address), JSON.stringify({ value: [{ ...correction, time: Number(correction.time), value: '99' }] }))
    expect((await readResponse(segment)).at(-1).value).toBe('99')
  })

  it('refreshes all vault, tranche and controller labels on cold and warm passes', async () => {
    await refreshHistorical()
    expect([...state.raw.keys()].sort()).toEqual(labels.map(({ label }) => getTimeseriesKey(label, 1, address)).sort())
    expect(state.full).toHaveBeenCalledTimes(6)
    await refreshHistorical()
    expect(state.full).toHaveBeenCalledTimes(6)
    expect(state.since).toHaveBeenCalledTimes(6)
    for (const args of state.since.mock.calls) expect(args[4]).toBe(pool)
  })

  it('demonstrates old backfills stay absent until reconciliation even after a successful refresh', async () => {
    const row = { time: BigInt(50 * DAY), component: 'tvl', value: '10.00' }
    const cached = JSON.stringify({ value: [], refreshedAt: now - DAY, reconciledAt: now - DAY })
    state.full.mockResolvedValue([row])
    state.since.mockResolvedValue([])
    const warm = await refreshHistoricalSeries(1, address, 'tvl-c', cached, now, false, pool)
    state.raw.set(getTimeseriesKey('tvl-c', 1, address), warm.payload)
    expect(await readResponse('tvl')).toEqual([])
    const forced = await refreshHistoricalSeries(1, address, 'tvl-c', warm.payload, now, true, pool)
    state.raw.set(getTimeseriesKey('tvl-c', 1, address), forced.payload)
    expect(await readResponse('tvl')).toEqual([{ ...row, time: Number(row.time) }])
  })

  it('counts completed Postgres work when Redis writing fails', async () => {
    state.full.mockResolvedValue([{ time: 1n, component: 'tvl', value: '1' }])
    state.failWrite = true
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await expect(refreshHistorical()).rejects.toThrow('Redis write failed')
      expect(state.full).toHaveBeenCalledTimes(6)
      expect(info).toHaveBeenCalledWith('timeseries-refresh-historical', expect.objectContaining({ series: 6, full: 6, rowsRead: 6 }))
    } finally { info.mockRestore() }
  })

  it('waits for slower successful reads before logging a failed query batch', async () => {
    let finish!: (rows: unknown[]) => void
    let began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    state.full.mockRejectedValueOnce(new Error('query failed'))
      .mockImplementationOnce(() => { began(); return new Promise(resolve => { finish = resolve }) })
      .mockResolvedValue([{ time: 1n, component: 'tvl', value: '1' }])
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const pending = expect(refreshHistorical()).rejects.toThrow('query failed')
      await started
      expect(info).not.toHaveBeenCalled()
      finish([{ time: 1n, component: 'tvl', value: '1' }])
      await pending
      expect(info).toHaveBeenCalledWith('timeseries-refresh-historical', expect.objectContaining({ series: 5, full: 5, rowsRead: 5 }))
      expect(state.raw.size).toBe(0)
    } finally { info.mockRestore() }
  })
})
