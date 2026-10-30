import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../prices', () => ({
  fetchErc20PriceUsd: vi.fn(async () => ({ priceUsd: 2000, priceSource: 'priceservice' }))
}))
vi.mock('../../../rpcs', () => ({ rpcs: {} }))
vi.mock('lib/blocks', () => ({}))
vi.mock('../../../db', () => ({ default: {}, some: vi.fn(), first: vi.fn(), getSparkline: vi.fn() }))
vi.mock('../2/vault/snapshot/hook', () => ({}))
vi.mock('./tranches/assets', () => ({}))

import { snapshotTvl } from './tvl'
import { fetchErc20PriceUsd } from '../../../prices'

const VAULT = '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as const
const ASSET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const fallback = { chainId: 1, address: VAULT, label: 'tvl-c', component: 'tvl', blockTime: 1n, close: 7 }

describe('snapshotTvl', () => {
  it('prices the snapshot totalAssets', async () => {
    const tvl = await snapshotTvl(1, VAULT, ASSET, 18, 3n * 10n ** 18n, 99n, fallback)
    expect(tvl).to.deep.equal({ chainId: 1, address: VAULT, label: 'tvl-c', component: 'tvl', blockTime: 99n, close: 6000 })
  })

  it('falls back to the series without assets or price', async () => {
    expect(await snapshotTvl(1, VAULT, ASSET, 18, undefined, 99n, fallback)).to.equal(fallback)
    vi.mocked(fetchErc20PriceUsd).mockResolvedValueOnce({ priceUsd: 0, priceSource: 'na' })
    expect(await snapshotTvl(1, VAULT, ASSET, 18, 1n, 99n, fallback)).to.equal(fallback)
  })
})
