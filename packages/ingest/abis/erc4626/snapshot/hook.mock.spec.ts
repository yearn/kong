import { beforeEach, describe, expect, it, vi } from 'vitest'

const { add, fetchErc20, extractErc20 } = vi.hoisted(() => ({
  add: vi.fn(),
  fetchErc20: vi.fn(),
  extractErc20: vi.fn()
}))

vi.mock('lib', () => ({ mq: { add, job: { load: { thing: 'load-thing' } } } }))
vi.mock('../../../db', () => ({ getSparkline: vi.fn(async () => []) }))
vi.mock('../../../helpers/apy-apr', () => ({
  getLatestApy: vi.fn(async () => undefined),
  getLatestOracleApr: vi.fn(async () => [undefined, undefined])
}))
vi.mock('../../yearn/lib', () => ({ fetchErc20, extractErc20 }))

import process from './hook'

const VAULT = '0x1000000000000000000000000000000000000001' as const
const ASSET = '0x2000000000000000000000000000000000000002' as const
const erc20 = { chainId: 1, address: ASSET, name: 'Asset', symbol: 'AST', decimals: 18n }

describe('abis/erc4626/snapshot/hook', () => {
  beforeEach(() => {
    add.mockReset()
    fetchErc20.mockReset()
    extractErc20.mockReset()
  })

  it('does not enqueue the erc20 thing when the row exists', async () => {
    fetchErc20.mockResolvedValue(erc20)
    const result = await process(1, VAULT, { asset: ASSET })
    expect(result.asset).toBe(erc20)
    expect(extractErc20).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('extracts and enqueues the erc20 thing when the row is missing', async () => {
    fetchErc20.mockResolvedValue(undefined)
    extractErc20.mockResolvedValue(erc20)
    const result = await process(1, VAULT, { asset: ASSET })
    expect(result.asset).toBe(erc20)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][1]).toMatchObject({ chainId: 1, address: ASSET, label: 'erc20' })
  })
})
