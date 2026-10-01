import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseError, ContractFunctionRevertedError } from 'viem'

const { readContract } = vi.hoisted(() => ({ readContract: vi.fn() }))

vi.mock('lib/rpcs', () => ({ rpcs: { next: () => ({ readContract }) } }))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlock: vi.fn() }))
vi.mock('../../snapshot/hook', () => ({ projectStrategies: vi.fn() }))
vi.mock('../../../../lib/apy', () => ({ computeApy: vi.fn(), computeNetApr: vi.fn(), extractFees__v3: vi.fn() }))

import { readApr } from './hook'

const ORACLE = '0x3000000000000000000000000000000000000003' as const

function revert() {
  const cause = new ContractFunctionRevertedError({ abi: [], functionName: 'getStrategyApr' })
  const error = new BaseError('reverted', { cause })
  return error
}

describe('abis/yearn/3/vault/timeseries/apr-oracle/hook readApr', () => {
  beforeEach(() => { readContract.mockReset() })

  it('remembers getCurrentApr per vault and skips getStrategyApr afterwards', async () => {
    const vault = '0x1000000000000000000000000000000000000001' as const
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'getStrategyApr') throw revert()
      return 5n * 10n ** 16n
    })

    expect(await readApr(1, vault, 100n, ORACLE)).toBeCloseTo(0.05)
    expect(readContract.mock.calls.map(c => c[0].functionName)).toEqual(['getStrategyApr', 'getCurrentApr'])

    readContract.mockClear()
    expect(await readApr(1, vault, 101n, ORACLE)).toBeCloseTo(0.05)
    expect(readContract.mock.calls.map(c => c[0].functionName)).toEqual(['getCurrentApr'])
  })

  it('uses getStrategyApr alone when it works', async () => {
    const vault = '0x4000000000000000000000000000000000000004' as const
    readContract.mockResolvedValue(10n ** 17n)
    expect(await readApr(1, vault, 100n, ORACLE)).toBeCloseTo(0.1)
    expect(readContract).toHaveBeenCalledTimes(1)
  })
})
