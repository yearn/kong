import { strict as assert } from 'node:assert'
import { buildTrancheSystem, TrancheSystemRows } from './db'

// Row shapes as the indexer writes them, captured from the Ethereum deployment:
// bigints land in jsonb as strings, and timestamps come back as epoch seconds.
const CONTROLLER = '0xF0145433E5289dd10712650dCd28333FA317eF36'
const MAIN_VAULT = '0xDa87123895a043Ed3610155550177C54ce8ba49B'
const HOOK = '0x776DEd3273440f1481d07B6CE916b5d5Fac170dC'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const TRANCHE_A = '0x2D4F47208853a3D20EADCbdA0F03900771C6Eba3'
const TRANCHE_E = '0xF0A070c0c5b808AbB8EeF6838f178D44A6d9376E'

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    hookState: {
      open: true,
      rateLimitWindow: '3600',
      depositLimit: '1000000000000',
      depositRateLimit: { used: '1000000000', windowStart: '1784581631', rateLimit: '100000000000' },
      withdrawRateLimit: { used: '0', windowStart: '0', rateLimit: '100000000000' },
      depositCap: '100000000000',
      withdrawCap: '2000980608',
      ...overrides,
    },
  }
}

function rows(overrides: Partial<TrancheSystemRows> = {}): TrancheSystemRows {
  return {
    chainId: 1,
    controller: CONTROLLER,
    snapshot: {
      VAULT: MAIN_VAULT,
      ASSET: USDC,
      reserveVault: '0x0000000000000000000000000000000000000000',
      totalClaims: '2001200086',
      vaultAssets: '2000980609',
      reserveAssets: '0',
      backingAssets: '2000980609',
      vaultMaxWithdraw: '2000980608',
    },
    hook: {
      tranches: [
        {
          address: TRANCHE_E, priority: 2, registered: true, accrualPaused: false, excessShareBps: 4000,
          targetRatePerSecondWad: '0', baselineAssets: '500000000', lastAccrual: '1784583851',
          pendingExcess: '0', liveAssets: '500000000', claim: '500000000', covered: '499780494',
        },
        {
          address: TRANCHE_A, priority: 0, registered: true, accrualPaused: false, excessShareBps: 0,
          targetRatePerSecondWad: '1584436925', baselineAssets: '1000000256', lastAccrual: '1784581955',
          pendingExcess: '0', liveAssets: '1000800086', claim: '1000800086', covered: '1000800086',
        },
      ],
    },
    blockNumber: '25600000',
    blockTime: BigInt(1784864807),
    assetDefaults: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    trancheRows: [
      {
        address: TRANCHE_A,
        defaults: {
          decimals: 6, priority: 0, trancheType: 'base', apiVersion: '3.1.0', name: 'yvUSD Fixed',
          symbol: 'yvUSD-A', inceptBlock: 25576299, inceptTime: 1784579135, trancheController: CONTROLLER,
        },
        snapshot: { hook: HOOK, name: 'yvUSD Fixed', symbol: 'yvUSD-A' },
        // window opened at 1784581631 and lasts 3600s, so it has expired by this snapshot
        hook: hookState(),
        blockNumber: '25600000',
        blockTime: BigInt(1784590000),
      },
      {
        address: TRANCHE_E,
        defaults: {
          decimals: 6, priority: 2, trancheType: 'locked', apiVersion: '3.1.0', name: 'yvUSD Equity',
          symbol: 'yvUSD-E', trancheController: CONTROLLER,
        },
        snapshot: { hook: HOOK },
        // window opened at 1784583851, still live at this snapshot
        hook: hookState({
          depositLimit: '100000000000',
          depositRateLimit: { used: '500000000', windowStart: '1784583851', rateLimit: '100000000000' },
          depositCap: '99500000000',
        }),
        blockNumber: '25600000',
        blockTime: BigInt(1784584000),
      },
    ],
    pps: new Map([[TRANCHE_A.toLowerCase(), { raw: 1000800, humanized: 1.0008 }]]),
    ...overrides,
  }
}

describe('buildTrancheSystem', () => {
  it('reports system accounting normalized to asset decimals', () => {
    const system = buildTrancheSystem(rows())

    assert.equal(system.asset.symbol, 'USDC')
    assert.equal(system.mainVault, MAIN_VAULT)
    assert.equal(system.accounting?.totalClaims, 2001.200086)
    assert.equal(system.accounting?.vaultAssets, 2000.980609)
    assert.equal(system.accounting?.backingAssets, 2000.980609)
    assert.ok(Math.abs((system.accounting?.coverageRatio ?? 0) - 1) < 0.001)
    assert.equal(system.blockNumber, 25600000)
    assert.equal(system.blockTime, 1784864807)
  })

  it('reports an unset reserve vault as absent', () => {
    assert.equal(buildTrancheSystem(rows()).reserveVault, null)
  })

  it('orders tranches by priority regardless of row order', () => {
    const system = buildTrancheSystem(rows())
    assert.deepEqual(system.tranches.map((tranche) => tranche.priority), [0, 2])
    assert.deepEqual(system.tranches.map((tranche) => tranche.symbol), ['yvUSD-A', 'yvUSD-E'])
    assert.deepEqual(system.tranches.map((tranche) => tranche.trancheType), ['base', 'locked'])
  })

  it('keeps the raw hook address alongside hookState', () => {
    const [senior] = buildTrancheSystem(rows()).tranches
    assert.equal(senior.hook, HOOK)
    assert.equal(senior.hookState?.open, true)
    assert.equal(senior.hookState?.rateLimitWindow, 3600)
    assert.equal(senior.hookState?.depositLimit, 1_000_000)
  })

  it('zeroes rate-limit usage once the fixed window has expired', () => {
    const [senior, equity] = buildTrancheSystem(rows()).tranches

    // 1784590000 >= 1784581631 + 3600: the bucket is gone
    assert.equal(senior.hookState?.depositRateLimit.used, 1000)
    assert.equal(senior.hookState?.depositRateLimit.effectiveUsed, 0)
    assert.equal(senior.hookState?.depositRateLimit.remaining, 100_000)

    // 1784584000 < 1784583851 + 3600: still counting
    assert.equal(equity.hookState?.depositRateLimit.used, 500)
    assert.equal(equity.hookState?.depositRateLimit.effectiveUsed, 500)
    assert.equal(equity.hookState?.depositRateLimit.remaining, 99_500)
  })

  it('reports capacity as the hook derives it', () => {
    const [senior, equity] = buildTrancheSystem(rows()).tranches
    assert.deepEqual(senior.capacity?.deposit, { cap: 100_000, limit: 1_000_000 })
    assert.deepEqual(senior.capacity?.withdraw, { cap: 2000.980608 })
    assert.deepEqual(equity.capacity?.deposit, { cap: 99_500, limit: 100_000 })
  })

  it('reports controller accounting and coverage per tranche', () => {
    const [senior, equity] = buildTrancheSystem(rows()).tranches

    assert.equal(senior.accounting?.liveAssets, 1000.800086)
    assert.equal(senior.accounting?.pendingExcess, 0)
    assert.equal(senior.accounting?.targetRatePerSecondWad, '1584436925')
    assert.equal(senior.coverage?.ratio, 1)

    assert.equal(equity.accounting?.excessShareBps, 4000)
    assert.ok(Math.abs((equity.coverage?.ratio ?? 0) - 499.780494 / 500) < 1e-9)
  })

  it('reports controller-backed price per share, or null when not yet computed', () => {
    const [senior, equity] = buildTrancheSystem(rows()).tranches
    assert.deepEqual(senior.pricePerShare, { raw: 1000800, humanized: 1.0008 })
    assert.equal(equity.pricePerShare, null)
  })

  it('serves metadata before its first snapshot', () => {
    const withoutSnapshot = rows()
    withoutSnapshot.trancheRows = [{
      ...withoutSnapshot.trancheRows[0],
      snapshot: null,
      hook: null,
      blockNumber: null,
      blockTime: null,
    }]

    const [senior] = buildTrancheSystem(withoutSnapshot).tranches
    assert.equal(senior.name, 'yvUSD Fixed')
    assert.equal(senior.hook, null)
    assert.equal(senior.hookState, null)
    assert.equal(senior.capacity, null)
    // controller accounting still resolves — it lives on the controller's snapshot
    assert.equal(senior.accounting?.liveAssets, 1000.800086)
  })
})
