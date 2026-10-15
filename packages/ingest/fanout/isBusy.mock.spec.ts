import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queued } = vi.hoisted(() => ({
  queued: {} as Record<string, ({ name: string; status: 'waiting' | 'prioritized' | 'active' } | undefined)[]>
}))

vi.mock('lib', () => ({
  chains: [{ id: 1 }],
  mq: {
    q: { fanout: 'fanout', extract: 'extract', load: 'load', probe: 'probe' },
    job: {
      fanout: { events: { name: 'events' }, timeseries: { name: 'timeseries' } },
      extract: {
        evmlog: { name: 'evmlog' }, snapshot: { name: 'snapshot' }, timeseries: { name: 'timeseries' },
        manuals: { name: 'manuals' }, webhook: { name: 'webhook' }
      },
      load: {
        evmlog: { name: 'evmlog' }, snapshot: { name: 'snapshot' }, thing: { name: 'thing' },
        output: { name: 'output' }, monitor: { name: 'monitor' }
      }
    },
    connect: vi.fn((queueName: string) => ({
      getJobs: vi.fn(async (statuses: string[]) => (queued[queueName] ?? []).filter(j => !j || statuses.includes(j.status))),
      close: vi.fn(async () => undefined)
    }))
  }
}))

import { findBusyMatch, isBusy } from './isBusy'

describe('isBusy', () => {
  beforeEach(() => { for (const k of Object.keys(queued)) delete queued[k] })

  it('is idle with no jobs', async () => {
    expect(await isBusy()).toBe(false)
  })

  it('ignores legacy price and waveydb jobs left in the queues', async () => {
    queued.load = [{ name: 'price', status: 'waiting' }]
    queued.extract = [{ name: 'waveydb', status: 'active' }]
    expect(await isBusy()).toBe(false)
  })

  it('ignores queued probe monitor jobs', async () => {
    queued.load = [{ name: 'monitor', status: 'prioritized' }]
    expect(await isBusy()).toBe(false)
  })

  it('reports a counted job', async () => {
    queued.load = [{ name: 'output', status: 'prioritized' }]
    expect(await findBusyMatch()).toEqual({ queue: 'load', jobName: 'output', status: 'prioritized' })
  })

  it('skips a job removed between the range read and the fetch', async () => {
    queued.load = [undefined, { name: 'output', status: 'prioritized' }]
    expect(await findBusyMatch()).toEqual({ queue: 'load', jobName: 'output', status: 'prioritized' })
  })

  it('reports per-chain extract jobs', async () => {
    queued['extract-1'] = [{ name: 'snapshot', status: 'active' }]
    expect(await findBusyMatch()).toEqual({ queue: 'extract-1', jobName: 'snapshot', status: 'active' })
  })
})
