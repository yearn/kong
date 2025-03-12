import { expect } from 'chai'
import { addresses } from '../../../test-addresses'
import { mainnet, polygon } from 'viem/chains'
import { _compute, extractFees__v2, extractFees__v3, extractLockedProfit__v2, extractLockedProfit__v3 } from './apy'
import { EvmLogSchema, ThingSchema } from 'lib/types'
import { upsertBatch } from '../../../load'
import db from '../../../db'

describe('abis/yearn/lib/apy', function() {
  this.timeout(20_000)

  this.beforeAll(async function() {
    {
      const harvest = EvmLogSchema.parse({
        chainId: mainnet.id, address: addresses.v2.yvusdt,
        eventName: 'StrategyReported', signature: '0x', topics: [], args: {}, hook: {},
        blockNumber: 15243268n, blockTime: 1n, logIndex: 1, transactionHash: '0x', transactionIndex: 1
      })
      await upsertBatch([harvest, {...harvest, blockNumber: 15243269n, blockTime: 2n}],
        'evmlog', 'chain_id, address, signature, block_number, log_index, transaction_hash')
    }

    {
      const harvest = EvmLogSchema.parse({
        chainId: polygon.id, address: addresses.v3.yvusdca,
        eventName: 'StrategyReported', signature: '0x', topics: [], args: {}, hook: {},
        blockNumber: 49181585n, blockTime: 1n, logIndex: 1, transactionHash: '0x', transactionIndex: 1
      })
      await upsertBatch([harvest, {...harvest, blockNumber: 49181586n, blockTime: 2n}],
        'evmlog', 'chain_id, address, signature, block_number, log_index, transaction_hash')
    }
  })

  this.afterAll(async function() {
    await db.query('DELETE FROM evmlog WHERE address = ANY($1)', [[addresses.v2.yvusdt, addresses.v3.yvusdca]])
  })

  it('extracts v2 fees', async function() {
    const strategies: `0x${string}`[] = [addresses.v2.strategyLenderYieldOptimiser]
    const fees = await extractFees__v2(mainnet.id, addresses.v2.yvusdt, strategies, 15871070n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.2)
  })

  it('extracts v2 locked profit', async function(this: Mocha.Context) {
    const lotsOfLockedProfit = await extractLockedProfit__v2(mainnet.id, addresses.v2.yvusdt, 18344466n)
    expect(lotsOfLockedProfit).to.eq(1912999444631n)

    const noLockedProfit = await extractLockedProfit__v2(mainnet.id, addresses.v2.yvusdt, 18965226n)
    expect(noLockedProfit).to.eq(0n)
  })

  it('yvUSDT 0.4.3 @ block 18344466', async function(this: Mocha.Context) {
    const blockNumber = 18344466n
    const strategies: `0x${string}`[] = [addresses.v2.strategyLenderYieldOptimiser]
    const yvusdt = ThingSchema.parse({
      chainId: 1,
      address: addresses.v2.yvusdt,
      label: 'vault',
      defaults: {
        apiVersion: '0.4.3',
        registry: '0xe15461b18ee31b7379019dc523231c57d1cbc18c',
        asset: addresses.v2.usdt,
        decimals: 6,
        inceptBlock: 14980240,
        inceptTime: 1655484586
      }
    })

    const apy = await _compute(yvusdt, strategies, blockNumber)

    expect(apy).to.not.be.undefined
    if (!apy) return

    expect(apy.blockNumber).to.eq(blockNumber)
    //002493204367606694
    expect(apy.net).to.be.closeTo(0.002493204367606694, 1e-5)
    expect(apy.grossApr).to.be.closeTo(0.0031127013901155465, 1e-5)

    expect(apy.weeklyNet).to.eq(0) //because it hadn't been harvested in over a week at this point
    expect(apy.weeklyPricePerShare).to.eq(1023043n)
    expect(Number(apy.weeklyBlockNumber)).to.be.closeTo(18294456, 4)

    expect(apy.monthlyNet).to.be.closeTo(0.002493204367606694, 1e-5)
    expect(apy.monthlyPricePerShare).to.be.eq(1022834n)
    expect(Number(apy.monthlyBlockNumber)).to.be.closeTo(18130373, 4)

    expect(apy.inceptionNet).to.be.closeTo(0.019352846869146623, 1e-5)
    expect(apy.inceptionPricePerShare).to.be.eq(1000000n)
    expect(Number(apy.inceptionBlockNumber)).to.be.closeTo(15243268, 4)
  })

  it('yvUSDT 0.4.3 @ block 15871070', async function(this: Mocha.Context) {
    const blockNumber = 15871070n
    const strategies: `0x${string}`[] = ['0xBc04eFD0D18685BA97cFAdE4e2D3171701B4099c', '0xd8F414beB0aEb5784c5e5eBe32ca9fC182682Ff8']
    const yvusdt = ThingSchema.parse({
      chainId: 1,
      address: addresses.v2.yvusdt,
      label: 'vault',
      defaults: {
        apiVersion: '0.4.3',
        registry: '0xe15461b18ee31b7379019dc523231c57d1cbc18c',
        asset: addresses.v2.usdt,
        decimals: 6,
        inceptBlock: 14980240,
        inceptTime: 1655484586
      }
    })

    const apy = await _compute(yvusdt, strategies, blockNumber)

    expect(apy).to.not.be.undefined
    if (!apy) return

    expect(apy.blockNumber).to.eq(blockNumber)

    expect(apy.net).to.be.closeTo(0.008496634004203418, 1e-5)
    expect(apy.grossApr).to.be.closeTo(0.010576786408629246, 1e-5)

    expect(apy.weeklyNet).to.be.closeTo(0.009051237192868822, 1e-5)
    expect(apy.weeklyPricePerShare).to.be.eq(1001670n)
    expect(Number(apy.weeklyBlockNumber)).to.be.closeTo(15820961, 4)

    expect(apy.monthlyNet).to.be.closeTo(0.008496634004203418, 1e-5)
    expect(apy.monthlyPricePerShare).to.be.eq(1001147n)
    expect(Number(apy.monthlyBlockNumber)).to.be.closeTo(15656324, 4)

    expect(apy.inceptionNet).to.be.closeTo(0.007697361270727177, 1e-5)
    expect(apy.inceptionPricePerShare).to.be.eq(1000000n)
    expect(Number(apy.inceptionBlockNumber)).to.be.closeTo(15243268, 4)
  })

  it('extracts v3 vault fees', async function() {
    const strategies: `0x${string}`[] = [addresses.v3.aaveV3UsdcLender, addresses.v3.compoundV3UsdcLender, addresses.v3.stargateUsdcStaker]
    const fees = await extractFees__v3(polygon.id, addresses.v3.yvusdca, strategies, 52031869n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.1)
  })

  it('extracts v3 tokenized strat fees', async function() {
    const fees = await extractFees__v3(polygon.id, addresses.v3.aaveV3UsdcLender, [], 52031869n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.05)
  })

  it('extracts v3 locked profit', async function(this: Mocha.Context) {
    const lotsOfLockedProfit = await extractLockedProfit__v3(polygon.id, addresses.v3.yvusdca, 52031869n)
    expect(lotsOfLockedProfit).to.eq(1340884331n)

    const noLockedProfit = await extractLockedProfit__v3(polygon.id, addresses.v3.yvusdca, 49181585n)
    expect(noLockedProfit).to.eq(0n)
  })

  it('yvUSDCA 3.0.1 @ block 52031869n', async function(this: Mocha.Context) {
    const blockNumber = 52031869n
    const strategies: `0x${string}`[] = [addresses.v3.aaveV3UsdcLender, addresses.v3.compoundV3UsdcLender, addresses.v3.stargateUsdcStaker]
    const yvusdca = ThingSchema.parse({
      chainId: polygon.id,
      address: addresses.v3.yvusdca,
      label: 'vault',
      defaults: {
        apiVersion: '3.0.1',
        registry: '0xfF5e3A7C4cBfA9Dd361385c24C3a0A4eE63CE500',
        asset: addresses.v3.usdc,
        decimals: 6,
        inceptBlock: 14980240,
        inceptTime: 1655484586
      }
    })
    const apy = await _compute(yvusdca, strategies, blockNumber)

    expect(apy).to.not.be.undefined
    if (!apy) return

    expect(apy.blockNumber).to.eq(blockNumber)

    expect(apy.net).to.be.closeTo(0.5053032615674182, 1e-5)
    expect(apy.grossApr).to.be.closeTo(0.4562300364137744, 1e-5)
    expect(apy.lockedProfit).to.be.eq(1340884331n)

    expect(apy.weeklyNet).to.be.closeTo(0.5053032615674182, 1e-5)
    expect(apy.weeklyPricePerShare).to.be.eq(1019009n)
    expect(Number(apy.weeklyBlockNumber)).to.be.closeTo(51764634, 4)

    expect(apy.monthlyNet).to.be.closeTo(0.293880331621855, 1e-5)
    expect(apy.monthlyPricePerShare).to.be.eq(1005328n)
    expect(Number(apy.monthlyBlockNumber)).to.be.closeTo(50876142, 4)

    expect(apy.inceptionNet).to.be.closeTo(0.13935788133629456, 1e-5)
    expect(apy.inceptionPricePerShare).to.be.eq(1000000n)
    expect(Number(apy.inceptionBlockNumber)).to.be.closeTo(49181585, 4)
  })
})
