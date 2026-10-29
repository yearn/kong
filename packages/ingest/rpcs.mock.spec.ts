import { afterEach, expect, it, vi } from 'vitest'
const { next } = vi.hoisted(() => ({ next: vi.fn() }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
import { latestBlocks, rpcs } from './rpcs'
afterEach(() => { vi.useRealTimers(); next.mockReset() })
it('routes reads to archive when the cached head is missing or stale', () => {
  vi.useFakeTimers({ now: 1_000_000 })
  rpcs.next(1, 700n)
  latestBlocks[1] = { blockNumber: 1000n, blockTime: 0n, observedAt: Date.now() }
  rpcs.next(1, 700n)
  rpcs.next(1, 500n)
  vi.advanceTimersByTime(60_001)
  rpcs.next(1, 700n)
  expect(next.mock.calls).toEqual([[1, true], [1, false], [1, true], [1, true]])
})
