import { expect } from 'chai'
import process, { extractComposition, resolveEstimatedApr } from './hook'
import db, { toUpsertSql } from '../../../../../db'
import { EstimatedAprSchema } from 'lib/types'

function debtFor(strategy: `0x${string}`) {
  return {
    strategy, activation: 0n, lastReport: 0n, currentDebt: 1n, currentDebtUsd: 1, maxDebt: 1n, maxDebtUsd: 1,
    performanceFee: 0n, totalGain: 0n, totalGainUsd: 0, totalLoss: 0n, totalLossUsd: 0,
    targetDebtRatio: undefined, maxDebtRatio: undefined
  }
}

describe('abis/yearn/3/vault/snapshot/hook', function() {
  it('uses one latest series_time for strategy performance components', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x1000000000000000000000000000000000000001'
    const strategy = '0x2000000000000000000000000000000000000002' as `0x${string}`
    const latest = BigInt(Math.floor(Date.now() / 1000))
    const stale = latest - 24n * 60n * 60n

    const outputs = [
      { component: 'net', value: 0.1, blockTime: stale, seriesTime: stale },
      { component: 'weeklyNet', value: 0.2, blockTime: latest, seriesTime: latest }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label: 'apy-bwd-delta-pps',
        component: output.component,
        value: output.value,
        block_number: output.blockTime,
        block_time: Number(output.blockTime),
        series_time: Number(output.seriesTime)
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const debts = [{
      strategy,
      activation: 0n,
      lastReport: 0n,
      currentDebt: 1n,
      currentDebtUsd: 1,
      maxDebt: 1n,
      maxDebtUsd: 1,
      performanceFee: 0n,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0,
      targetDebtRatio: undefined,
      maxDebtRatio: undefined
    }]

    try {
      const composition = await extractComposition(chainId, vault, [strategy], debts)

      expect(composition).to.have.length(1)
      expect(composition[0].performance?.historical?.weeklyNet).to.equal(0.2)
      expect(composition[0].performance?.historical?.net).to.equal(undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses composition when estimated apr rows have only netAPR/netAPY components', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x3000000000000000000000000000000000000003'
    const strategy = '0x4000000000000000000000000000000000000004' as `0x${string}`
    const latest = Math.floor(Date.now() / 1000)

    const outputs = [
      { component: 'netAPR', value: 0.03 },
      { component: 'netAPY', value: 0.031 }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label: 'katana-estimated-apr',
        component: output.component,
        value: output.value,
        block_number: latest,
        block_time: latest,
        series_time: latest
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const debts = [{
      strategy,
      activation: 0n,
      lastReport: 0n,
      currentDebt: 1n,
      currentDebtUsd: 1,
      maxDebt: 1n,
      maxDebtUsd: 1,
      performanceFee: 0n,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0,
      targetDebtRatio: undefined,
      maxDebtRatio: undefined
    }]

    try {
      const composition = await extractComposition(chainId, vault, [strategy], debts, 'katana-estimated-apr')

      expect(composition).to.have.length(1)
      expect(composition[0].performance?.estimated?.type).to.equal('katana-estimated-apr')
      expect(composition[0].performance?.estimated?.apr).to.equal(0.03)
      expect(composition[0].performance?.estimated?.apy).to.equal(0.031)
      expect(composition[0].performance?.estimated?.components).to.deep.equal({})
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('promotes gross and net estimated apr components in composition', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x7000000000000000000000000000000000000007'
    const strategy = '0x8000000000000000000000000000000000000008' as `0x${string}`
    const latest = Math.floor(Date.now() / 1000)

    const outputs = [
      { component: 'netAPR', value: 0.03 },
      { component: 'netAPY', value: 0.031 },
      { component: 'grossAPR', value: 0.05 },
      { component: 'grossAPY', value: 0.051 },
      { component: 'compoundingPeriodsPerYear', value: 365 }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label: 'katana-estimated-apr',
        component: output.component,
        value: output.value,
        block_number: latest,
        block_time: latest,
        series_time: latest
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const debts = [{
      strategy,
      activation: 0n,
      lastReport: 0n,
      currentDebt: 1n,
      currentDebtUsd: 1,
      maxDebt: 1n,
      maxDebtUsd: 1,
      performanceFee: 0n,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0,
      targetDebtRatio: undefined,
      maxDebtRatio: undefined
    }]

    try {
      const composition = await extractComposition(chainId, vault, [strategy], debts, 'katana-estimated-apr')

      expect(composition).to.have.length(1)
      const estimated = composition[0].performance?.estimated
      expect(estimated?.apr).to.equal(0.03)
      expect(estimated?.apy).to.equal(0.031)
      expect(estimated?.grossAPR).to.equal(0.05)
      expect(estimated?.grossAPY).to.equal(0.051)
      expect(estimated?.components).to.deep.equal({ compoundingPeriodsPerYear: 365 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('echoes snapshot pricePerShare to override stale hook keys', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x5000000000000000000000000000000000000005'
    const asset = '0x6000000000000000000000000000000000000006'
    const pricePerShare = 1021955n
    const assetData = {
      chain_id: chainId,
      address: asset,
      label: 'erc20',
      defaults: { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
    }
    await db.query(toUpsertSql('thing', 'chain_id, address, label', assetData), Object.values(assetData))

    try {
      const composition = await extractComposition(chainId, vault, [], [])
      const hook = await process(chainId, vault, { asset, pricePerShare })

      expect(composition).to.have.length(0)
      expect(hook.pricePerShare).to.equal(pricePerShare)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to the unscoped label when the vault only has a strategy-scoped emission', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0xb00000000000000000000000000000000000000b' as `0x${string}`
    const strategy = '0xc00000000000000000000000000000000000000c' as `0x${string}`
    const now = Math.floor(Date.now() / 1000)
    const label = 'katana-estimated-apr'

    const rows = [
      { address: vault, component: 'netAPR', value: 0.04 },
      { address: vault, component: 'isStrategy', value: 1 },
      { address: strategy, component: 'netAPR', value: 0.03 }
    ]
    for (const row of rows) {
      const outputData = {
        chain_id: chainId, address: row.address, label, component: row.component, value: row.value,
        block_number: now, block_time: now, series_time: now
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    try {
      const resolved = await resolveEstimatedApr(chainId, vault)
      expect(resolved.estimatedApr).to.equal(undefined)
      expect(resolved.estimatedAprLabel).to.equal(label)

      const composition = await extractComposition(chainId, vault, [strategy], [debtFor(strategy)], resolved.estimatedAprLabel)
      expect(composition[0].performance?.estimated?.apr).to.equal(0.03)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps the vault-scoped label when a newer strategy-scoped emission exists', async function() {
    const chainId = 1337
    const vault = '0xd00000000000000000000000000000000000000d' as `0x${string}`
    const now = Math.floor(Date.now() / 1000)
    const older = now - 60

    for (const row of [
      { label: 'crv-estimated-apr', component: 'netAPR', value: 0.02, time: older },
      { label: 'yvusd-estimated-apr', component: 'netAPR', value: 0.08, time: now },
      { label: 'yvusd-estimated-apr', component: 'isStrategy', value: 1, time: now }
    ]) {
      const outputData = {
        chain_id: chainId, address: vault, label: row.label, component: row.component, value: row.value,
        block_number: row.time, block_time: row.time, series_time: row.time
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const resolved = await resolveEstimatedApr(chainId, vault)
    expect(resolved.estimatedApr?.type).to.equal('crv-estimated-apr')
    expect(resolved.estimatedApr?.apr).to.equal(0.02)
    expect(resolved.estimatedAprLabel).to.equal('crv-estimated-apr')
  })

  it('drops null-valued estimated components instead of writing apr: null', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x9000000000000000000000000000000000000009' as `0x${string}`
    const strategy = '0xa00000000000000000000000000000000000000a' as `0x${string}`
    const now = Math.floor(Date.now() / 1000)
    const label = 'katana-estimated-apr'

    const outputData = {
      chain_id: chainId, address: strategy, label, component: 'netAPR', value: null,
      block_number: now, block_time: now, series_time: now
    }
    await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))

    try {
      const composition = await extractComposition(chainId, vault, [strategy], [debtFor(strategy)], label)
      const estimated = composition[0].performance?.estimated
      expect(estimated).to.not.equal(undefined)
      expect(estimated).to.not.have.property('apr')
      expect(estimated?.components).to.deep.equal({})
      expect(() => EstimatedAprSchema.parse(estimated)).to.not.throw()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
