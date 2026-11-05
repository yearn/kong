import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../prices', () => ({
  fetchErc20PriceUsd: vi.fn(async () => ({ priceUsd: 0, priceSource: 'na' }))
}))

const { someMock, totalAssets, readAssetsMock } = vi.hoisted(() => {
  const totalAssets = { value: 5000000000000000000n }
  return {
    someMock: vi.fn<(query: string, params: unknown[]) => Promise<boolean>>(async () => false),
    totalAssets,
    readAssetsMock: vi.fn(async () => totalAssets.value as bigint | undefined)
  }
})

vi.mock('../../../rpcs', () => ({
  rpcs: {
    next: () => ({
      multicall: async ({ contracts }: { contracts: { functionName: string }[] }) =>
        contracts.map(contract => contract.functionName === 'totalAssets'
          ? { status: 'success', result: totalAssets.value }
          : { status: 'failure' })
    })
  }
}))

vi.mock('lib/blocks', () => ({
  estimateHeight: vi.fn(async () => 100n),
  getBlock: vi.fn(async () => ({ number: 100n, timestamp: 1700000000n }))
}))

vi.mock('../../../db', () => ({
  default: {},
  some: someMock,
  first: vi.fn(async () => ({
    chainId: 1,
    address: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95',
    label: 'vault',
    defaults: {
      apiVersion: '3.0.0',
      asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18
    }
  }))
}))

vi.mock('../2/vault/snapshot/hook', () => ({
  extractWithdrawalQueue: vi.fn(async () => [])
}))

vi.mock('./tranches/assets', () => ({ readAuthoritativeAssets: readAssetsMock }))

import _process from './tvl'
import { fetchErc20PriceUsd } from '../../../prices'
import { Data } from '../../../extract/timeseries'

const VAULT = '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as const
const today = { outputLabel: 'tvl-c', blockTime: BigInt(Math.floor(Date.now() / 1000) + 3600) } as Data
const pastDay = { outputLabel: 'tvl-c', blockTime: 1600000000n } as Data

describe('tvl hook on price service 404 (missing price)', () => {
  beforeEach(() => {
    vi.mocked(fetchErc20PriceUsd).mockResolvedValue({ priceUsd: 0, priceSource: 'na' } as never)
    totalAssets.value = 5000000000000000000n
    someMock.mockReset()
    someMock.mockResolvedValue(false)
  })

  it('skips the open day instead of persisting tvl=0', async () => {
    expect(await _process(1, VAULT, today, true)).to.deep.equal([])
    expect(await _process(1, VAULT, today, false)).to.deep.equal([])
  })

  it('still writes a genuine 0 for an empty vault on the open day', async () => {
    totalAssets.value = 0n
    readAssetsMock.mockResolvedValueOnce(0n)
    const outputs = await _process(1, VAULT, today, true)
    expect(outputs.find(o => o.component === 'tvl')?.value).to.equal(0)
  })

  it('writes null usd components for a past day instead of an asserted zero', async () => {
    const outputs = await _process(1, VAULT, pastDay, true)
    expect(outputs).to.have.length(5)
    const byComponent = Object.fromEntries(outputs.map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(null)
    expect(byComponent['delegated']).to.equal(null)
    expect(byComponent['priceUsd']).to.equal(null)
    expect(byComponent['totalAssets']).to.equal(5)
  })

  it('never overwrites a past day that already holds a real tvl', async () => {
    someMock.mockResolvedValue(true)
    expect(await _process(1, VAULT, pastDay, true)).to.deep.equal([])
  })

  it('writes real values once the price exists', async () => {
    vi.mocked(fetchErc20PriceUsd).mockResolvedValue({ priceUsd: 2, priceSource: 'priceservice' } as never)
    const byComponent = Object.fromEntries((await _process(1, VAULT, pastDay, true)).map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(10)
    expect(byComponent['priceUsd']).to.equal(2)
    expect(someMock).not.toHaveBeenCalled()
  })
})
