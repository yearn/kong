import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

describe('getVaultsWithSnapshots', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('coalesces name to thing.address only after defaults/snapshot/hook sources', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const { getVaultsWithSnapshots } = await import('./db')
    await getVaultsWithSnapshots()

    const executedSql = query.mock.calls[0][0] as string
    const coalesceMatch = executedSql.match(/COALESCE\(\s*thing\.defaults->>'name',([\s\S]*?)\)\s+AS name/)
    assert.ok(coalesceMatch, 'expected a name COALESCE in the query')
    const args = coalesceMatch![1].split(',').map((arg) => arg.trim())
    assert.equal(args[args.length - 1], 'thing.address')
  })

  it('returns the address as name when no other source has populated it yet', async () => {
    const chainId = 1
    const address = '0x1111111111111111111111111111111111111111'

    query.mockResolvedValueOnce({
      rows: [{
        chainId,
        address,
        name: address,
        symbol: null,
        apiVersion: null,
        decimals: null,
        asset: null,
        tvl: null,
        performance: null,
        fees: null,
        category: null,
        type: null,
        kind: null,
        v3: false,
        isRetired: false,
        isHidden: false,
        isBoosted: false,
        isHighlighted: false,
        inclusion: {},
        strategiesCount: 0,
        riskLevel: null,
        migration: false,
        origin: null,
        inceptBlock: null,
        inceptTime: null,
        staking: null,
        pricePerShare: null,
        _defaults: null,
        _snapshot: null,
        _hook: null,
        _hasSnapshot: false
      }]
    })

    const { getVaultsWithSnapshots } = await import('./db')
    const [result] = await getVaultsWithSnapshots()

    assert.equal(result.listError, null)
    assert.equal(result.listItem?.name, address)
  })

  it('keeps promoted gross APR and APY on the estimated performance block', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        chainId: 1,
        address: '0x2222222222222222222222222222222222222222',
        name: 'test vault',
        symbol: null,
        apiVersion: null,
        decimals: null,
        asset: null,
        tvl: null,
        performance: {
          estimated: {
            apr: 0.05,
            apy: 0.051,
            grossAPR: 0.07,
            grossAPY: 0.072,
            type: 'katana-estimated-apr',
            components: { katRewardsAPR: 0.012 }
          }
        },
        fees: null,
        category: null,
        type: null,
        kind: null,
        v3: false,
        isRetired: false,
        isHidden: false,
        isBoosted: false,
        isHighlighted: false,
        inclusion: {},
        strategiesCount: 0,
        riskLevel: null,
        migration: false,
        origin: null,
        inceptBlock: null,
        inceptTime: null,
        staking: null,
        pricePerShare: null,
        _defaults: null,
        _snapshot: null,
        _hook: null,
        _hasSnapshot: false
      }]
    })

    const { getVaultsWithSnapshots } = await import('./db')
    const [result] = await getVaultsWithSnapshots()

    assert.equal(result.listError, null)
    assert.equal(result.listItem?.performance?.estimated?.grossAPR, 0.07)
    assert.equal(result.listItem?.performance?.estimated?.grossAPY, 0.072)
  })
})
