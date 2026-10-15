import { describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db', () => ({ default: { query }, firstRow: vi.fn() }))
import { getLatestEstimatedAprV3 } from './apy-apr'

describe('Katana debt coverage read path', () => {
  it('preserves all three debt-coverage components through getLatestEstimatedAprV3', async () => {
    query.mockResolvedValue({ rows: Object.entries({
      netAPR: 0.062, netAPY: 0.064,
      estimatedDebtCoverage: 0, morphoBaseAPY: 0.041, morphoRewardsAPR: 0.019
    }).map(([component, value]) => ({ label: 'katana-estimated-apr', address: '0xvault', component, value })) })
    expect(await getLatestEstimatedAprV3(1, '0xvault')).toEqual({
      type: 'katana-estimated-apr', apr: 0.062, apy: 0.064,
      components: { estimatedDebtCoverage: 0, morphoBaseAPY: 0.041, morphoRewardsAPR: 0.019 }
    })
  })
})
