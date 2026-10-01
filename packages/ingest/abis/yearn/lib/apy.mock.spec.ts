import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readContract } = vi.hoisted(() => ({ readContract: vi.fn() }))

vi.mock('../../../rpcs', () => ({ rpcs: { next: () => ({ readContract, multicall: vi.fn() }) } }))
vi.mock('../../../db', () => ({ default: {}, first: vi.fn(), query: vi.fn() }))
vi.mock('../../../prices', () => ({ fetchErc20PriceUsd: vi.fn() }))
vi.mock('../2/vault/snapshot/hook', () => ({ projectStrategies: vi.fn(), mapStrategyParams: vi.fn() }))
vi.mock('../3/vault/snapshot/hook', () => ({ projectStrategies: vi.fn() }))
vi.mock('../2/strategy/event/hook', () => ({ extractFeesBps: vi.fn() }))

import { extractFees__v3 } from './apy'

const VAULT = '0x1000000000000000000000000000000000000001' as const
const ACCOUNTANT = '0x2000000000000000000000000000000000000002' as const
const BLOCK = 12345n

describe('abis/yearn/lib/apy fees', () => {
  beforeEach(() => { readContract.mockReset() })

  it('reads accountant() once, at blockNumber', async () => {
    readContract.mockResolvedValue(ACCOUNTANT)
    const fees = await extractFees__v3(1, VAULT, [], BLOCK)

    expect(fees).toEqual({ performance: 0, management: 0 })
    expect(readContract).toHaveBeenCalledTimes(1)
    expect(readContract.mock.calls[0][0]).toMatchObject({ functionName: 'accountant', address: VAULT, blockNumber: BLOCK })
  })

  it('reads performanceFee() at blockNumber when there is no accountant', async () => {
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'accountant') throw new Error('no accountant')
      return 1000
    })
    const fees = await extractFees__v3(1, VAULT, [], BLOCK)

    expect(fees).toEqual({ performance: 0.1, management: 0 })
    expect(readContract.mock.calls.map(c => c[0].functionName)).toEqual(['accountant', 'performanceFee'])
    for (const [params] of readContract.mock.calls) expect(params.blockNumber).toBe(BLOCK)
  })
})
