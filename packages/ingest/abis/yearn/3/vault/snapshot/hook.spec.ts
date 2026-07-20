import { expect } from 'chai'
import { extractComposition } from './hook'
import db, { toUpsertSql } from '../../../../../db'

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
})
