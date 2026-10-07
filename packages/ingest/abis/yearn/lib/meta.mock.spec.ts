import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wrap } = vi.hoisted(() => ({ wrap: vi.fn() }))

vi.mock('lib', () => ({ cache: { wrap } }))

import { getVaultMeta } from './meta'

const VAULT = '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as const

describe('abis/yearn/lib/meta', () => {
  beforeEach(() => {
    wrap.mockReset()
    wrap.mockImplementation(async () => ({ value: { [VAULT]: { displayName: 'yvTest' } }, at: Date.now() }))
  })

  it('serves repeat lookups from memory, one cache.wrap per (type, chain)', async () => {
    expect((await getVaultMeta(1, VAULT))?.displayName).toBe('yvTest')
    expect((await getVaultMeta(1, VAULT))?.displayName).toBe('yvTest')
    expect(wrap).toHaveBeenCalledTimes(1)
  })

  it('misses on another chain', async () => {
    await getVaultMeta(10, VAULT)
    expect(wrap).toHaveBeenCalledTimes(1)
    expect(wrap.mock.calls[0][0]).toBe('abis/yearn/lib/meta/vaults/10')
  })

  it('refetches after the TTL', async () => {
    vi.useFakeTimers()
    try {
      await getVaultMeta(137, VAULT)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      await getVaultMeta(137, VAULT)
      expect(wrap).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not outlive the Redis entry it was read from', async () => {
    vi.useFakeTimers()
    try {
      wrap.mockImplementation(async () => ({ value: { [VAULT]: { displayName: 'yvTest' } }, at: Date.now() - 4 * 60 * 1000 }))
      await getVaultMeta(8453, VAULT)
      vi.advanceTimersByTime(60 * 1000 + 1)
      await getVaultMeta(8453, VAULT)
      expect(wrap).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
