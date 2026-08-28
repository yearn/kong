import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../prices', () => ({
  fetchErc20PriceUsd: vi.fn(async () => ({ priceUsd: 0, priceSource: 'unavailable' }))
}))

const { someMock, totalAssets } = vi.hoisted(() => ({ someMock: vi.fn(async () => false), totalAssets: { value: 5000000000000000000n } }))

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

import _process from './tvl'
import { fetchErc20PriceUsd } from '../../../prices'
import { Data } from '../../../extract/timeseries'
import { endOfDay } from 'lib/dates'

const VAULT = '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as const
const data = { outputLabel: 'tvl', blockTime: 1600000000n } as Data

describe('tvl hook on price service unavailable', () => {
  beforeEach(() => {
    vi.mocked(fetchErc20PriceUsd).mockResolvedValue({ priceUsd: 0, priceSource: 'unavailable' })
    someMock.mockReset()
    someMock.mockResolvedValue(false)
    totalAssets.value = 5000000000000000000n
  })

  it('still writes component rows, null for usd components, real on-chain values', async () => {
    const outputs = await _process(1, VAULT, data, true)
    expect(outputs).to.have.length(5)

    const byComponent = Object.fromEntries(outputs.map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(null)
    expect(byComponent['delegated']).to.equal(null)
    expect(byComponent['priceUsd']).to.equal(null)
    expect(byComponent['totalAssets']).to.equal(5)
    expect(byComponent['delegatedAssets']).to.equal(0)
  })

  it('still writes the legacy tvl row with a null value', async () => {
    const outputs = await _process(1, VAULT, data, false)
    expect(outputs).to.have.length(1)
    expect(outputs[0].component).to.equal('tvl')
    expect(outputs[0].value).to.equal(null)
  })

  it('writes nothing for the current day, so latest-row queries keep yesterday', async () => {
    const outputs = await _process(1, VAULT, { outputLabel: 'tvl', blockTime: 9999999999n } as Data, true)
    expect(outputs).to.deep.equal([])
  })

  it('writes real values when the price resolves', async () => {
    vi.mocked(fetchErc20PriceUsd).mockResolvedValue({ priceUsd: 2, priceSource: 'priceservice' })
    const outputs = await _process(1, VAULT, data, true)
    const byComponent = Object.fromEntries(outputs.map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(10)
    expect(byComponent['priceUsd']).to.equal(2)
  })

  it('skips a past day that already holds a real tvl', async () => {
    someMock.mockResolvedValue(true)
    expect(await _process(1, VAULT, data, true)).to.deep.equal([])

    const [, params] = someMock.mock.calls[0]
    expect(params[3]).to.equal(Number(endOfDay(1600000000n)))
  })

  it('writes null again when the stored day is already null', async () => {
    someMock.mockResolvedValue(false)
    const outputs = await _process(1, VAULT, data, true)
    expect(outputs).to.have.length(5)

    const byComponent = Object.fromEntries(outputs.map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(null)
  })

  it('writes zero tvl for an empty vault when the price is unavailable and the day is uncomputed', async () => {
    totalAssets.value = 0n
    const outputs = await _process(1, VAULT, data, true)
    const byComponent = Object.fromEntries(outputs.map(o => [o.component, o.value]))
    expect(byComponent['tvl']).to.equal(0)
    expect(byComponent['delegated']).to.equal(0)
    expect(byComponent['priceUsd']).to.equal(null)
  })

  it('skips an already-computed day for an empty vault, preserving its stored priceUsd', async () => {
    totalAssets.value = 0n
    someMock.mockResolvedValue(true)
    expect(await _process(1, VAULT, data, true)).to.deep.equal([])
  })

  it('does not query for an already-computed day when the price resolves', async () => {
    vi.mocked(fetchErc20PriceUsd).mockResolvedValue({ priceUsd: 2, priceSource: 'priceservice' })
    await _process(1, VAULT, data, true)
    expect(someMock).not.toHaveBeenCalled()
  })
})
