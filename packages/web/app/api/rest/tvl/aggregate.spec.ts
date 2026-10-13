import { strict as assert } from 'node:assert'
import { calculateAggregateTvl, getAggregateTvlStrategyRefs } from './aggregate'
import type { AggregateTvlSnapshot } from './aggregate'

const A = '0x0000000000000000000000000000000000000001'
const B = '0x0000000000000000000000000000000000000002'
const C = '0x0000000000000000000000000000000000000003'
const STRATEGY = '0x0000000000000000000000000000000000000010'

function vault(
  chainId: number,
  address: string,
  grossTvl: unknown,
  mergedSnapshot: Record<string, unknown> = {},
  hook: Record<string, unknown> | null = {},
): AggregateTvlSnapshot {
  return {
    chainId,
    address,
    hook: hook === null ? null : { tvl: { close: grossTvl }, ...hook },
    mergedSnapshot,
  }
}

function resultFor(
  result: ReturnType<typeof calculateAggregateTvl>,
  chainId: number,
  address: string,
) {
  const row = result.vaults.find(vault => vault.chainId === chainId && vault.address === address.toLowerCase())
  assert.ok(row, `expected vault ${chainId}:${address} in aggregate`)
  return row
}

function assertAggregateInvariants(result: ReturnType<typeof calculateAggregateTvl>) {
  for (const row of result.vaults) {
    assert.equal(row.grossTvl - row.deductedTvl, row.contribution)
    assert.equal(row.deductions.reduce((total, deduction) => total + deduction.amount, 0), row.deductedTvl)
  }

  for (const chain of result.chains) {
    const vaults = result.vaults.filter(vault => vault.chainId === chain.chainId)
    assert.equal(vaults.reduce((total, vault) => total + vault.grossTvl, 0), chain.grossTvl)
    assert.equal(vaults.reduce((total, vault) => total + vault.deductedTvl, 0), chain.deductedTvl)
    assert.equal(vaults.reduce((total, vault) => total + vault.contribution, 0), chain.tvl)
    assert.equal(chain.grossTvl - chain.deductedTvl, chain.tvl)
  }

  assert.equal(result.chains.reduce((total, chain) => total + chain.grossTvl, 0), result.grossTvl)
  assert.equal(result.chains.reduce((total, chain) => total + chain.deductedTvl, 0), result.deductedTvl)
  assert.equal(result.chains.reduce((total, chain) => total + chain.tvl, 0), result.tvl)
  assert.equal(result.grossTvl - result.deductedTvl, result.tvl)
}

describe('calculateAggregateTvl', () => {
  it('sums independent vaults and keeps per-vault, per-chain, and total invariants', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100),
      vault(10, B, 40),
    ], [], new Date('2026-01-02T03:04:05.000Z'))

    assert.equal(result.tvl, 140)
    assert.equal(result.grossTvl, 140)
    assert.equal(result.deductedTvl, 0)
    assert.equal(result.updatedAt, '2026-01-02T03:04:05.000Z')
    assert.deepEqual(result.chains.map(chain => chain.chainId), [1, 10])
    assertAggregateInvariants(result)
  })

  it('subtracts a V3 allocation to an included child while retaining outside child deposits', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, {
        v3: true,
      }, {
        debts: [
          { strategy: B, currentDebtUsd: 80 },
          // A repeated debt record and mirrored composition entry are not new positions.
          { strategy: B, currentDebtUsd: 50 },
        ],
        composition: [{ address: B, currentDebtUsd: 80 }],
      }),
      vault(1, B, 150),
    ])

    const parent = resultFor(result, 1, A)
    assert.equal(parent.deductions.length, 1)
    assert.deepEqual(parent.deductions[0], {
      targetChainId: 1,
      targetAddress: B,
      amount: 80,
      reason: 'v3-debt',
    })
    assert.equal(resultFor(result, 1, B).contribution, 150)
    assert.equal(result.tvl, 170)
    assertAggregateInvariants(result)
  })

  it('deducts a wrapper fully and skips any additional debt deductions from it', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 70, {
        asset: { address: B },
        v3: true,
      }, {
        debts: [{ strategy: B, currentDebtUsd: 25 }],
      }),
      vault(1, B, 100),
    ])

    const wrapper = resultFor(result, 1, A)
    assert.equal(wrapper.contribution, 0)
    assert.deepEqual(wrapper.deductions, [{
      targetChainId: 1,
      targetAddress: B,
      amount: 70,
      reason: 'underlying-vault',
    }])
    assert.equal(result.tvl, 100)
    assertAggregateInvariants(result)
  })

  it('deducts each shared-child allocation once and keeps the child TVL', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, { v3: true }, { debts: [{ strategy: C, currentDebtUsd: 80 }] }),
      vault(1, B, 100, { v3: true }, { debts: [{ strategy: C, currentDebtUsd: 60 }] }),
      vault(1, C, 150),
    ])

    assert.equal(resultFor(result, 1, A).contribution, 20)
    assert.equal(resultFor(result, 1, B).contribution, 40)
    assert.equal(resultFor(result, 1, C).contribution, 150)
    assert.equal(result.tvl, 210)
    assertAggregateInvariants(result)
  })

  it('uses V2 totalDebtUsd and ignores debt targets on other chains', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, {
        v3: false,
      }, {
        debts: [{ strategy: B, totalDebtUsd: 25, currentDebtUsd: 90 }],
      }),
      vault(10, B, 60),
    ])

    assert.equal(resultFor(result, 1, A).contribution, 100)
    assert.equal(resultFor(result, 10, B).contribution, 60)
    assert.equal(result.tvl, 160)
    assertAggregateInvariants(result)
  })

  it('uses V2 totalDebtUsd for same-chain allocations', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, { v3: false }, {
        debts: [{ strategy: B, totalDebtUsd: 25, currentDebtUsd: 90 }],
      }),
      vault(1, B, 60),
    ])

    assert.deepEqual(resultFor(result, 1, A).deductions, [{
      targetChainId: 1,
      targetAddress: B,
      amount: 25,
      reason: 'v2-debt',
    }])
    assert.equal(result.tvl, 135)
    assertAggregateInvariants(result)
  })

  it('reads debt allocations from the raw hook even when merged state shadows that field', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, {
        v3: true,
        debts: [{ strategy: B, currentDebtUsd: 90 }],
      }, {
        debts: [{ strategy: B, currentDebtUsd: 25 }],
      }),
      vault(1, B, 150),
    ])

    assert.equal(resultFor(result, 1, A).deductedTvl, 25)
    assert.equal(result.tvl, 225)
    assertAggregateInvariants(result)
  })

  it('deducts only the indirect exposure attributable to the parent', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, {}, { debts: [{ strategy: STRATEGY, totalDebtUsd: 500 }] }),
      vault(1, B, 150),
      vault(1, C, 200),
      vault(10, B, 400),
    ], [{
      chainId: 1,
      address: STRATEGY,
      hook: {
        aggregateTvlExposures: [
          { parentChainId: 1, parentVaultAddress: A, targetChainId: 1, targetVaultAddress: B, attributableUsd: 30 },
          // Repeated facts from one strategy describe the same position; keep the max.
          { parentChainId: 1, parentVaultAddress: A, targetChainId: 1, targetVaultAddress: B, attributableUsd: 25 },
          // A separate parent shares this strategy; its position is not A's exposure.
          { parentChainId: 1, parentVaultAddress: C, targetChainId: 1, targetVaultAddress: B, attributableUsd: 40 },
          // An exposure is ignored when its target is not in the included vault set.
          { parentChainId: 1, parentVaultAddress: A, targetChainId: 137, targetVaultAddress: B, attributableUsd: 60 },
        ],
      },
    }])

    const parent = resultFor(result, 1, A)
    assert.equal(parent.contribution, 70)
    assert.deepEqual(parent.deductions, [{
      targetChainId: 1,
      targetAddress: B,
      amount: 30,
      reason: 'strategy-exposure',
    }])
    assert.equal(resultFor(result, 10, B).contribution, 400)
    assertAggregateInvariants(result)
  })

  it('estimates a mapped strategy target from the parent debt, including cross-chain targets', () => {
    const REMOTE = '0x0000000000000000000000000000000000000020'
    const result = calculateAggregateTvl([
      vault(1, A, 100, { v3: true }, { debts: [
        { strategy: STRATEGY, currentDebtUsd: 30 },
        { strategy: STRATEGY, currentDebtUsd: 25 },
        { strategy: REMOTE, currentDebtUsd: 20 },
      ] }),
      vault(1, B, 150),
      vault(747474, C, 50),
    ], [
      { chainId: 1, address: STRATEGY, hook: { aggregateTvlTarget: { chainId: 1, address: B } } },
      { chainId: 1, address: REMOTE, hook: { aggregateTvlTarget: { chainId: 747474, address: C } } },
    ])

    assert.deepEqual(resultFor(result, 1, A).deductions, [
      { targetChainId: 1, targetAddress: B, amount: 30, reason: 'strategy-exposure' },
      { targetChainId: 747474, targetAddress: C, amount: 20, reason: 'strategy-exposure' },
    ])
    assert.equal(result.tvl, 250)
    assertAggregateInvariants(result)
  })

  it('prefers observed exposures over the debt estimate for the same strategy', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, {}, { debts: [{ strategy: STRATEGY, totalDebtUsd: 80 }] }),
      vault(1, B, 150),
    ], [{
      chainId: 1,
      address: STRATEGY,
      hook: {
        aggregateTvlTarget: { chainId: 1, address: B },
        aggregateTvlExposures: [
          { parentChainId: 1, parentVaultAddress: A, targetChainId: 1, targetVaultAddress: B, attributableUsd: 10 },
        ],
      },
    }])

    assert.equal(resultFor(result, 1, A).deductedTvl, 10)
    assertAggregateInvariants(result)
  })

  it('shares one child budget across all parents and deduction kinds', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, { v3: true }, { debts: [{ strategy: C, currentDebtUsd: 70 }] }),
      vault(1, B, 100, { v3: true }, { debts: [{ strategy: STRATEGY, currentDebtUsd: 70 }] }),
      vault(1, C, 100),
    ], [{ chainId: 1, address: STRATEGY, hook: { aggregateTvlTarget: { chainId: 1, address: C } } }])

    assert.equal(resultFor(result, 1, A).deductedTvl, 70)
    assert.equal(resultFor(result, 1, B).deductedTvl, 30)
    assert.equal(result.tvl, 200)
    assertAggregateInvariants(result)
  })

  it('caps a wrapper at the underlying vault budget', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, { asset: { address: C } }),
      vault(1, C, 60),
    ])

    assert.equal(resultFor(result, 1, A).contribution, 40)
    assert.equal(result.tvl, 100)
    assertAggregateInvariants(result)
  })

  it('stops tracing at included vaults so nested exposure is deducted by the immediate parent only', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 100, { v3: true }, { debts: [{ strategy: B, currentDebtUsd: 80 }] }),
      vault(1, B, 80, { v3: true }, { debts: [{ strategy: C, currentDebtUsd: 30 }] }),
      vault(1, C, 50),
    ], [{
      chainId: 1,
      address: B,
      hook: {
        // A direct vault target is a tracing boundary; this copy cannot add a
        // second, transitive A -> C deduction.
        aggregateTvlExposures: [
          { parentChainId: 1, parentVaultAddress: A, targetChainId: 1, targetVaultAddress: C, attributableUsd: 30 },
        ],
      },
    }])

    assert.deepEqual(resultFor(result, 1, A).deductions, [{
      targetChainId: 1,
      targetAddress: B,
      amount: 80,
      reason: 'v3-debt',
    }])
    assert.deepEqual(resultFor(result, 1, B).deductions, [{
      targetChainId: 1,
      targetAddress: C,
      amount: 30,
      reason: 'v3-debt',
    }])
    assert.equal(result.tvl, 120)
    assertAggregateInvariants(result)
  })

  it('caps combined deductions at gross TVL and ignores malformed amounts and snapshots', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 50, {
      }, {
        debts: [
          { strategy: B, totalDebtUsd: 80 },
          { strategy: B, totalDebtUsd: Number.NaN },
          { strategy: C, totalDebtUsd: -1 },
          { strategy: STRATEGY, totalDebtUsd: 1_000 },
        ],
      }),
      vault(1, B, 100),
      vault(1, C, 100),
      vault(1, STRATEGY, 200),
      vault(1, '0x0000000000000000000000000000000000000004', null),
      vault(1, '0x0000000000000000000000000000000000000005', -5),
      vault(1, '0x0000000000000000000000000000000000000006', Infinity),
    ])

    const parent = resultFor(result, 1, A)
    assert.equal(parent.contribution, 0)
    assert.equal(parent.deductedTvl, 50)
    assert.equal(parent.deductions.reduce((total, deduction) => total + deduction.amount, 0), 50)
    assert.equal(result.vaults.some(row => row.address.endsWith('0004')), false)
    assert.equal(result.vaults.some(row => row.address.endsWith('0005')), false)
    assert.equal(result.vaults.some(row => row.address.endsWith('0006')), false)
    assertAggregateInvariants(result)
  })

  it('counts duplicate chain/address rows once using normalized address identity', () => {
    const mixedAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const duplicate = vault(1, mixedAddress.toUpperCase().replace('0X', '0x'), 100)
    const result = calculateAggregateTvl([
      vault(1, mixedAddress, 100),
      duplicate,
      vault(10, mixedAddress, 25),
    ])

    assert.equal(result.grossTvl, 125)
    assert.equal(result.vaults.filter(row => row.chainId === 1 && row.address === mixedAddress).length, 1)
    assert.equal(result.vaults.length, 2)
    assertAggregateInvariants(result)
  })

  it('uses asset-address matching only on the same chain', () => {
    const result = calculateAggregateTvl([
      vault(1, A, 70, { asset: { address: B } }),
      vault(10, B, 100),
    ])

    assert.equal(resultFor(result, 1, A).contribution, 70)
    assert.equal(result.tvl, 170)
    assertAggregateInvariants(result)
  })
})


describe('getAggregateTvlStrategyRefs', () => {
  it('skips included vaults but retains same-address references on other chains', () => {
    const refs = getAggregateTvlStrategyRefs([
      vault(1, A, 100, {}, { debts: [{ strategy: B }, { strategy: STRATEGY }, { strategy: STRATEGY }] }),
      vault(1, B, 50),
      vault(10, A, 100, {}, { debts: [{ strategy: B }] }),
    ])
    assert.deepEqual(refs, [
      { chainId: 1, address: STRATEGY },
      { chainId: 10, address: B },
    ])
  })

  it('retains strategies whose vault snapshot has unusable TVL', () => {
    assert.deepEqual(getAggregateTvlStrategyRefs([
      vault(1, A, 100, {}, { debts: [{ strategy: B }] }),
      vault(1, B, null),
    ]), [{ chainId: 1, address: B }])
  })
})
