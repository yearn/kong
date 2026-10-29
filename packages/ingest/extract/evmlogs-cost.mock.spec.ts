import { beforeEach, describe, expect, it, vi } from 'vitest'
const { decimals } = vi.hoisted(() => ({ decimals: vi.fn() }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: decimals }))
import { tooSmall } from './evmlogs'
const address = '0x0000000000000000000000000000000000000001'
beforeEach(() => { decimals.mockReset() })
describe('event amount filtering', () => {
  it('does not resolve metadata for events without an amount', async () => {
    expect(await tooSmall(1, address, { strategy: address })).toBe(false)
    expect(decimals).not.toHaveBeenCalled()
  })
  it.each(['value', 'assets', 'amount'])('still filters %s, including zero', async field => {
    decimals.mockResolvedValue({ success: true, decimals: 6 })
    expect(await tooSmall(1, address, { [field]: 0n })).toBe(true)
    expect(await tooSmall(1, address, { [field]: 99_999n })).toBe(true)
    expect(await tooSmall(1, address, { [field]: 100_000n })).toBe(false)
  })
  it('retains events when metadata is unavailable', async () => {
    decimals.mockResolvedValue({ success: false })
    expect(await tooSmall(1, address, { amount: 1n })).toBe(false)
  })
})
