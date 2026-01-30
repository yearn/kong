import { expect } from 'chai'
import { extractComposition } from './hook'
import db, { toUpsertSql } from '../../../../../db'

describe('abis/yearn/2/vault/snapshot/hook', function() {
  this.timeout(10000)

  it('extracts composition with performance', async function() {
    const chainId = 1337
    const vault = '0x1000000000000000000000000000000000000001'
    const strategy = '0x2000000000000000000000000000000000000002'
    const blockTime = 1000n
    const blockNumber = 1000n

    const snapshotData = {
      chain_id: chainId,
      address: strategy,
      block_time: Number(blockTime),
      block_number: blockNumber,
      snapshot: { name: 'Strategy One' },
      hook: {
        performance: {
          estimated: { apr: 0.1, apy: 0.12, type: 'crv', components: {} }
        }
      }
    }
    await db.query(toUpsertSql('snapshot', 'chain_id, address', snapshotData), Object.values(snapshotData))

    const withdrawalQueue = [strategy as `0x${string}`]
    const debts = [{
      strategy: strategy as `0x${string}`,
      performanceFee: 0n,
      activation: 0n,
      debtRatio: 100n,
      minDebtPerHarvest: 0n,
      maxDebtPerHarvest: 0n,
      lastReport: 0n,
      totalDebt: 100n,
      totalDebtUsd: 100,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0
    }]

    const composition = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts)

    expect(composition).to.have.length(1)
    expect(composition[0].address).to.equal(strategy)
    expect(composition[0].performance).to.not.be.undefined
    expect(composition[0].performance?.estimated?.apr).to.equal(0.1)
    expect(composition[0].performance?.estimated?.apy).to.equal(0.12)
    expect(composition[0].performance?.estimated?.type).to.equal('crv')
  })

  it('verifies crv-like vault 0xf165... (mocked)', async function() {
    const chainId = 1
    const vault = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88'
    const strategy = '0x1111111111111111111111111111111111111111' // Mock strategy
    const blockTime = BigInt(Math.floor(Date.now() / 1000))
    const blockNumber = 18000000n

    // Mock output data used by getLatestEstimatedApr
    const outputData = {
      chain_id: chainId,
      address: strategy,
      label: 'crv-estimated-apr',
      component: 'netAPR',
      value: 0.05,
      block_number: blockNumber,
      block_time: Number(blockTime),
      series_time: Number(blockTime)
    }
    await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))

    // Mock strategy snapshot
    const snapshotData = {
      chain_id: chainId,
      address: strategy,
      block_number: blockNumber,
      block_time: Number(blockTime),
      snapshot: { name: 'Strategy Curve' },
      hook: {
        performance: {
          estimated: { apr: 0.05, apy: 0.0, type: 'crv', components: {} }
        }
      }
    }
    await db.query(toUpsertSql('snapshot', 'chain_id, address', snapshotData), Object.values(snapshotData))

    const withdrawalQueue = [strategy as `0x${string}`]
    const debts = [{
      strategy: strategy as `0x${string}`,
      performanceFee: 0n,
      activation: 0n,
      debtRatio: 100n,
      minDebtPerHarvest: 0n,
      maxDebtPerHarvest: 0n,
      lastReport: 0n,
      totalDebt: 100n,
      totalDebtUsd: 100,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0
    }]

    const composition = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts)

    expect(composition[0].performance?.estimated?.apr).to.equal(0.05)
    expect(composition[0].performance?.estimated?.type).to.equal('crv')
  })

})
