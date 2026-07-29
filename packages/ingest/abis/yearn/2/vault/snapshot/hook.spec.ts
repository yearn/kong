import { expect } from 'chai'
import { decodeEventLog, encodeAbiParameters, getAddress, pad, toEventSelector } from 'viem'
import { extractComposition, mapStrategyParams, projectStrategies, projectStrategyEvents, resolveStrategies, union } from './hook'
import db, { toUpsertSql } from '../../../../../db'
import vaultAbi from '../abi'
import abiutil from '../../../../../abiutil'

const selectors = {
  added: toEventSelector('event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 minDebtPerHarvest, uint256 maxDebtPerHarvest, uint256 performanceFee)'),
  addedLegacy: toEventSelector('event StrategyAdded(address indexed strategy, uint256 debtRatio, uint256 rateLimit, uint256 performanceFee)'),
  migrated: toEventSelector('event StrategyMigrated(address indexed oldVersion, address indexed newVersion)'),
  revoked: toEventSelector('event StrategyRevoked(address indexed strategy)')
}

async function seedLog(vault: string, signature: string, args: object, blockNumber: number) {
  const row = {
    chain_id: 1337,
    address: vault,
    event_name: 'test',
    signature,
    topics: [signature],
    args: JSON.stringify(args),
    block_number: blockNumber,
    block_time: blockNumber,
    log_index: 0,
    transaction_hash: `0xtest${blockNumber}`,
    transaction_index: 0
  }
  await db.query(toUpsertSql('evmlog', 'chain_id, address, signature, block_number, log_index, transaction_hash', row), Object.values(row))
}

describe('abis/yearn/2/vault/snapshot/hook', () => {
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

    const composition = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts, '0.4.3')

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

    const composition = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts, '0.4.3')

    expect(composition[0].performance?.estimated?.apr).to.equal(0.05)
    expect(composition[0].performance?.estimated?.type).to.equal('crv')
  })

  it('projects strategies added by the legacy 4-arg StrategyAdded event', async function() {
    const vault = '0x3000000000000000000000000000000000000001'
    const strategy = '0x3000000000000000000000000000000000000002'
    await seedLog(vault, selectors.addedLegacy, { strategy }, 100)

    const strategies = await projectStrategies(1337, vault)
    expect(strategies).to.deep.equal([strategy])
  })

  it('projects strategies discovered by migration only', async function() {
    const vault = '0x3000000000000000000000000000000000000011'
    const oldVersion = '0x3000000000000000000000000000000000000012'
    const newVersion = '0x3000000000000000000000000000000000000013'
    await seedLog(vault, selectors.migrated, { oldVersion, newVersion }, 100)

    const strategies = await projectStrategies(1337, vault)
    expect(strategies).to.deep.equal([newVersion])
  })

  it('ignores revokes for strategies that were never projected', async function() {
    const vault = '0x3000000000000000000000000000000000000021'
    const strategy = '0x3000000000000000000000000000000000000022'
    const unknown = '0x3000000000000000000000000000000000000023'
    await seedLog(vault, selectors.added, { strategy }, 100)
    await seedLog(vault, selectors.revoked, { strategy: unknown }, 200)

    const strategies = await projectStrategies(1337, vault)
    expect(strategies).to.deep.equal([strategy])
  })

  it('decodes both StrategyAdded arities from the single vault abi', function() {
    const addedEvents = abiutil.events(vaultAbi).filter((e: { name: string }) => e.name === 'StrategyAdded')
    expect(addedEvents.map((e: never) => toEventSelector(e))).to.have.members([selectors.added, selectors.addedLegacy])

    const strategy = getAddress('0x8000000000000000000000000000000000000001')

    const legacy = decodeEventLog({
      abi: vaultAbi,
      topics: [selectors.addedLegacy, pad(strategy)],
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [9500n, 2n, 1000n])
    })
    expect(legacy.eventName).to.equal('StrategyAdded')
    expect(legacy.args).to.deep.equal({ strategy, debtRatio: 9500n, rateLimit: 2n, performanceFee: 1000n })

    const modern = decodeEventLog({
      abi: vaultAbi,
      topics: [selectors.added, pad(strategy)],
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [9500n, 2n, 3n, 1000n])
    })
    expect(modern.eventName).to.equal('StrategyAdded')
    expect(modern.args).to.deep.equal({ strategy, debtRatio: 9500n, minDebtPerHarvest: 2n, maxDebtPerHarvest: 3n, performanceFee: 1000n })
  })

  it('projects distinct strategies from mixed legacy and modern adds', async function() {
    const vault = '0x3000000000000000000000000000000000000041'
    const legacy = '0x3000000000000000000000000000000000000042'
    const modern = '0x3000000000000000000000000000000000000043'
    await seedLog(vault, selectors.addedLegacy, { strategy: legacy }, 100)
    await seedLog(vault, selectors.added, { strategy: modern }, 200)

    const strategies = await projectStrategies(1337, vault)
    expect(strategies).to.deep.equal([legacy, modern])
  })

  it('dedupes repeated strategy adds', async function() {
    const vault = '0x3000000000000000000000000000000000000031'
    const strategy = '0x3000000000000000000000000000000000000032'
    await seedLog(vault, selectors.addedLegacy, { strategy }, 100)
    await seedLog(vault, selectors.added, { strategy }, 200)

    const strategies = await projectStrategies(1337, vault)
    expect(strategies).to.deep.equal([strategy])
  })

  it('maps 8-field StrategyParams for 0.3.0-0.3.1', function() {
    const fields = [1n, 2n, 9924n, 4n, 5n, 6n, 7n, 8n]
    const params = mapStrategyParams('0.3.0', fields)
    expect(params).to.deep.equal({
      performanceFee: 1n, activation: 2n, debtRatio: 9924n,
      minDebtPerHarvest: 0n, maxDebtPerHarvest: 0n,
      lastReport: 5n, totalDebt: 6n, totalGain: 7n, totalLoss: 8n
    })
  })

  it('maps 8-field StrategyParams for 0.2.2 without publishing debtLimit as debtRatio', function() {
    const fields = [1n, 2n, 1000000n, 4n, 5n, 6n, 7n, 8n]
    const params = mapStrategyParams('0.2.2', fields)
    expect(params.debtRatio).to.equal(0n)
    expect(params.totalDebt).to.equal(6n)
  })

  it('maps 9-field StrategyParams for 0.3.2+', function() {
    const fields = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]
    const params = mapStrategyParams('0.3.2', fields)
    expect(params).to.deep.equal({
      performanceFee: 1n, activation: 2n, debtRatio: 3n,
      minDebtPerHarvest: 4n, maxDebtPerHarvest: 5n,
      lastReport: 6n, totalDebt: 7n, totalGain: 8n, totalLoss: 9n
    })
  })

  it('unions projected strategies and queue entries case-insensitively', function() {
    const a = '0x4000000000000000000000000000000000000001' as `0x${string}`
    const b = '0x4000000000000000000000000000000000000002' as `0x${string}`
    const result = union([a], [a.toUpperCase().replace('0X', '0x') as `0x${string}`, b])
    expect(result).to.deep.equal([a, b])
  })

  it('marks debt-bearing ratio-zero queue entries active on ratioless (pre-0.3.0) vaults only', async function() {
    const chainId = 1337
    const vault = '0x5000000000000000000000000000000000000001'
    const strategy = '0x5000000000000000000000000000000000000002'

    const withdrawalQueue = [strategy as `0x${string}`]
    const debts = [{
      strategy: strategy as `0x${string}`,
      performanceFee: 0n,
      activation: 0n,
      debtRatio: 0n,
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

    const oldest = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts, '0.2.2')
    expect(oldest[0].status).to.equal('active')

    const modern = await extractComposition(chainId, vault, [strategy as `0x${string}`], withdrawalQueue, debts, '0.4.3')
    expect(modern[0].status).to.equal('inactive')
  })

  it('tracks revoked strategies separately and clears them on re-add', async function() {
    const vault = '0x6000000000000000000000000000000000000001'
    const a = '0x6000000000000000000000000000000000000002'
    const b = '0x6000000000000000000000000000000000000003'
    await seedLog(vault, selectors.added, { strategy: a }, 100)
    await seedLog(vault, selectors.added, { strategy: b }, 200)
    await seedLog(vault, selectors.revoked, { strategy: a }, 300)
    await seedLog(vault, selectors.revoked, { strategy: b }, 400)
    await seedLog(vault, selectors.added, { strategy: b }, 500)

    const { strategies, revoked } = await projectStrategyEvents(1337, vault)
    expect(strategies).to.deep.equal([b])
    expect(revoked).to.deep.equal([a])
  })

  it('includes queue-only candidates in composition', async function() {
    const chainId = 1337
    const vault = '0x9000000000000000000000000000000000000001'
    const queueOnly = '0x9000000000000000000000000000000000000002' as `0x${string}`

    const strategies = resolveStrategies([], [queueOnly], [], [])
    const composition = await extractComposition(chainId, vault, strategies, [queueOnly], [], '0.4.3')

    expect(composition).to.have.length(1)
    expect(composition[0].address).to.equal(queueOnly)
    expect(composition[0].status).to.equal('inactive')
  })

  it('keeps revoked residual-debt strategies non-active with their debt row', async function() {
    const chainId = 1337
    const vault = '0xa000000000000000000000000000000000000001'
    const residual = '0xa000000000000000000000000000000000000002' as `0x${string}`
    const debts = [{
      strategy: residual,
      performanceFee: 0n,
      activation: 0n,
      debtRatio: 0n,
      minDebtPerHarvest: 0n,
      maxDebtPerHarvest: 0n,
      lastReport: 0n,
      totalDebt: 10000n,
      totalDebtUsd: 0.01,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0
    }]

    const strategies = resolveStrategies([], [], [residual], debts)
    const composition = await extractComposition(chainId, vault, strategies, [], debts, '0.3.0')

    expect(composition).to.have.length(1)
    expect(composition[0].address).to.equal(residual)
    expect(composition[0].status).to.equal('unallocated')
    expect(composition[0].debtRatio).to.equal(0n)
    expect(composition[0].totalDebt).to.equal(10000n)
  })

  it('keeps revoked strategies with residual debt and drops zero-debt revoked ones', function() {
    const projected = ['0x7000000000000000000000000000000000000001'] as `0x${string}`[]
    const queue = ['0x7000000000000000000000000000000000000001'] as `0x${string}`[]
    const residual = '0x7000000000000000000000000000000000000002' as `0x${string}`
    const cleared = '0x7000000000000000000000000000000000000003' as `0x${string}`
    const debts = [
      { strategy: residual, totalDebt: 10000n },
      { strategy: cleared, totalDebt: 0n }
    ]

    const strategies = resolveStrategies(projected, queue, [residual, cleared], debts)
    expect(strategies).to.deep.equal([projected[0], residual])
  })

})
