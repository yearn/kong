import { describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../../../../../db', () => ({ default: { query } }))
vi.mock('../../../../../rpcs', () => ({ rpcs: { next: () => ({}) } }))

import { projectVaults } from './hook'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const C = '0x00000000000000000000000000000000000000c3'

describe('abis/yearn/3/accountant/snapshot/hook', () => {
  it('projectVaults ignores remove of an unknown vault', async () => {
    query.mockResolvedValue({ rows: [
      { args: { vault: A, change: 1 } },
      { args: { vault: B, change: 1 } },
      { args: { vault: C, change: 2 } }
    ] })
    const vaults = await projectVaults(1, '0x5000000000000000000000000000000000000005')
    expect(vaults).toHaveLength(2)
  })
})
