import { expect } from 'chai'
import { addresses } from '../../../test-addresses'
import { mainnet, polygon } from 'viem/chains'
import { _compute, computeApy, computeNetApr, extractFees__v2, extractFees__v3, extractLockedProfit__v2, extractLockedProfit__v3 } from './apy'
import { EvmLogSchema, ThingSchema } from 'lib/types'
import { upsertBatch } from '../../../load'
import db from '../../../db'

describe('abis/yearn/lib/apy', () => {
  beforeAll(async () => {
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

  afterAll(async () => {
    await db.query('DELETE FROM evmlog WHERE address = ANY($1)', [[addresses.v2.yvusdt, addresses.v3.yvusdca]])
  })

  it('extracts v2 fees', async () => {
    const strategies: `0x${string}`[] = [addresses.v2.strategyLenderYieldOptimiser]
    const fees = await extractFees__v2(mainnet.id, addresses.v2.yvusdt, strategies, 15871070n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.2)
  }, 20_000)

  it('extracts v2 locked profit', async () => {
    const lotsOfLockedProfit = await extractLockedProfit__v2(mainnet.id, addresses.v2.yvusdt, 18344466n)
    expect(lotsOfLockedProfit).to.eq(1912999444631n)

    const noLockedProfit = await extractLockedProfit__v2(mainnet.id, addresses.v2.yvusdt, 18965226n)
    expect(noLockedProfit).to.eq(0n)
  }, 20_000)

  it('yvUSDT 0.4.3 @ block 18344466', async () => {
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
  }, 20_000)

  it('yvUSDT 0.4.3 @ block 15871070', async () => {
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
  }, 20_000)

  it('extracts v3 vault fees', async () => {
    const strategies: `0x${string}`[] = [addresses.v3.aaveV3UsdcLender, addresses.v3.compoundV3UsdcLender, addresses.v3.stargateUsdcStaker]
    const fees = await extractFees__v3(polygon.id, addresses.v3.yvusdca, strategies, 52031869n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.1)
  }, 20_000)

  it('extracts v3 tokenized strat fees', async () => {
    const fees = await extractFees__v3(polygon.id, addresses.v3.aaveV3UsdcLender, [], 52031869n)
    expect(fees.management).to.eq(0)
    expect(fees.performance).to.eq(.05)
  }, 20_000)

  it('extracts v3 locked profit', async () => {
    const lotsOfLockedProfit = await extractLockedProfit__v3(polygon.id, addresses.v3.yvusdca, 52031869n)
    expect(lotsOfLockedProfit).to.eq(1340884331n)

    const noLockedProfit = await extractLockedProfit__v3(polygon.id, addresses.v3.yvusdca, 49181585n)
    expect(noLockedProfit).to.eq(0n)
  }, 20_000)

  it('yvUSDCA 3.0.1 @ block 52031869n', async () => {
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
  }, 20_000)

  describe('computeNetApr', () => {
    it('returns gross APR when fees are zero', () => {
      expect(computeNetApr(0.10, { management: 0, performance: 0 })).to.equal(0.10)
    })

    it('correctly applies performance and management fees', () => {
      // grossApr=0.10, management=0.02, performance=0.20
      // netApr = (0.10 - 0.02) * (1 - 0.20) = 0.08 * 0.80 = 0.064
      expect(computeNetApr(0.10, { management: 0.02, performance: 0.20 })).to.be.closeTo(0.064, 1e-10)
    })

    it('floors net APR at half gross APR when performance fee is 100%', () => {
      expect(computeNetApr(0.10, { management: 0, performance: 1.0 })).to.equal(0.05)
    })

    it('handles zero gross APR', () => {
      expect(computeNetApr(0, { management: 0, performance: 0.20 })).to.equal(0)
    })

    it('returns zero for negative gross APR', () => {
      expect(computeNetApr(-0.01, { management: 0.0025, performance: 0.10 })).to.equal(0)
    })

    it('floors net APR at half gross APR when fees exceed gross APR', () => {
      const gross = 0.00076638918973244
      expect(computeNetApr(gross, { management: 0.0025, performance: 0.10 })).to.equal(gross / 2)
    })

    it('handles no strategies (zero fees)', () => {
      expect(computeNetApr(0.05, { management: 0, performance: 0 })).to.equal(0.05)
    })
  })

  describe('computeApy', () => {
    it('returns 0 for zero APR', () => {
      expect(computeApy(0)).to.equal(0)
    })

    it('compounds weekly (52 periods)', () => {
      const apr = 0.10
      const expected = (1 + apr / 52) ** 52 - 1
      expect(computeApy(apr)).to.be.closeTo(expected, 1e-15)
    })

    it('returns 0 for Infinity', () => {
      expect(computeApy(Infinity)).to.equal(0)
    })
  })
})
