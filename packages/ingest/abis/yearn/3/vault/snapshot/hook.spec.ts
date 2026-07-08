import { expect } from 'chai'
import { extractComposition } from './hook'
import db, { toUpsertSql } from '../../../../../db'

describe('abis/yearn/3/vault/snapshot/hook', function() {
  afterEach(async function() {
    await db.query('DELETE FROM output WHERE chain_id IN (1337, 1338)')
    await db.query('DELETE FROM snapshot WHERE chain_id IN (1337, 1338)')
  })

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

  it('promotes strategy estimated gross and net rows while keeping rewards in components', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1338
    const vault = '0x1000000000000000000000000000000000000001'
    const strategy = '0x2000000000000000000000000000000000000002' as `0x${string}`
    const latest = BigInt(Math.floor(Date.now() / 1000))
    const label = 'katana-estimated-apr'

    const outputs = [
      { component: 'apr', value: 0.04 },
      { component: 'apy', value: 0.041 },
      { component: 'grossAPR', value: 0.06 },
      { component: 'grossAPY', value: 0.061 },
      { component: 'netAPR', value: 0.05 },
      { component: 'netAPY', value: 0.051 },
      { component: 'baseNetAPY', value: 0.03 },
      { component: 'katRewardsAPR', value: 0.5 }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label,
        component: output.component,
        value: output.value,
        block_number: latest,
        block_time: Number(latest),
        series_time: Number(latest)
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
      const composition = await extractComposition(chainId, vault, [strategy], debts, label)
      const estimated = composition[0].performance?.estimated

      expect(estimated?.apr).to.equal(0.04)
      expect(estimated?.apy).to.equal(0.041)
      expect(estimated?.grossAPR).to.equal(0.06)
      expect(estimated?.grossAPY).to.equal(0.061)
      expect(estimated?.netAPR).to.equal(0.05)
      expect(estimated?.netAPY).to.equal(0.051)
      expect(estimated?.components).to.deep.equal({
        baseNetAPY: 0.03,
        katRewardsAPR: 0.5
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
