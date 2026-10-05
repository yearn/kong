import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queued } = vi.hoisted(() => ({
  queued: {} as Record<string, { name: string; status: 'waiting' | 'prioritized' | 'active' }[]>
}))

vi.mock('lib', () => ({
  chains: [{ id: 1 }],
  mq: {
    q: { fanout: 'fanout', extract: 'extract', load: 'load', probe: 'probe' },
    job: {
      fanout: { events: { name: 'events' }, timeseries: { name: 'timeseries' } },
      extract: {
        evmlog: { name: 'evmlog' }, snapshot: { name: 'snapshot' }, timeseries: { name: 'timeseries' },
        manuals: { name: 'manuals' }, waveydb: { name: 'waveydb' }, webhook: { name: 'webhook' }
      },
      load: {
        evmlog: { name: 'evmlog' }, snapshot: { name: 'snapshot' }, thing: { name: 'thing' },
        output: { name: 'output' }, price: { name: 'price' }, monitor: { name: 'monitor' }
      }
    },
    connect: vi.fn((queueName: string) => ({
      getJobs: vi.fn(async (statuses: string[]) => (queued[queueName] ?? []).filter(j => statuses.includes(j.status))),
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

  it.each([{ queue: 'extract-1', name: 'evmlog' }, { queue: 'load', name: 'evmlog' }])('guards prioritized coverage work: %j', async ({ queue, name }) => {
    queued[queue] = [{ name, status: 'prioritized' }]
    expect(await findBusyMatch()).toEqual({ queue, jobName: name, status: 'prioritized' })
  })

  it('reports a counted job', async () => {
    queued.load = [{ name: 'output', status: 'prioritized' }]
    expect(await findBusyMatch()).toEqual({ queue: 'load', jobName: 'output', status: 'prioritized' })
  })

  it('reports per-chain extract jobs', async () => {
    queued['extract-1'] = [{ name: 'snapshot', status: 'active' }]
    expect(await findBusyMatch()).toEqual({ queue: 'extract-1', jobName: 'snapshot', status: 'active' })
  })
})
