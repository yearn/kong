import { expect } from 'chai'
import { ThingSchema } from 'lib/types'
import { toEventSelector } from 'viem'
import { mainnet } from 'viem/chains'
import { afterAll, beforeAll } from 'vitest'
import db from '../../../db'
import { addresses } from '../../../test-addresses'
import { _compute } from './apy'
import { readPps } from './assets'

// apy must have no price-per-share path of its own: every observation it samples
// has to come from the shared reader, or a tranche and an ordinary vault would
// end up measured by different rules. Asserting each observation equals the
// reader's value at the block apy sampled is what pins that down.
const BLOCK = 18417431n
const FIRST_HARVEST_BLOCK = 18100000n
const SECOND_HARVEST_BLOCK = 18100100n

const vault = ThingSchema.parse({
  chainId: mainnet.id,
  address: addresses.v2.yvweth,
  label: 'vault',
  defaults: {
    apiVersion: '0.4.2',
    asset: addresses.v2.weth,
    decimals: 18,
    inceptBlock: 12588794,
    inceptTime: 1623088086
  }
})

describe('abis/yearn/lib/apy shared pps reader', function() {
  beforeAll(async function() {
    // inception is the first of two harvests; seed the pair apy requires, far
    // enough back that the weekly and monthly lookbacks both land after it
    const signature = toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 debtPaid, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)')
    for (const [index, blockNumber] of [FIRST_HARVEST_BLOCK, SECOND_HARVEST_BLOCK].entries()) {
      await db.query(`
        INSERT INTO evmlog (chain_id, address, event_name, signature, topics, args, hook,
          block_number, block_time, log_index, transaction_hash, transaction_index)
        VALUES ($1, $2, 'StrategyReported', $3, '{}', '{}', '{}', $4, to_timestamp(1694000000), $5, $6, 0)
        ON CONFLICT DO NOTHING
      `, [mainnet.id, vault.address, signature, blockNumber, index, `0xsharedpps${index}`])
    }
  })

  afterAll(async function() {
    await db.query('DELETE FROM evmlog WHERE chain_id = $1 AND address = $2', [mainnet.id, vault.address])
  })

  it('samples every pps observation through the shared reader', async function() {
    const apy = await _compute(vault, [], BLOCK)

    expect(apy.inceptionBlockNumber).to.equal(FIRST_HARVEST_BLOCK)
    expect(apy.pricePerShare).to.equal(await readPps(vault, BLOCK))
    expect(apy.inceptionPricePerShare).to.equal(await readPps(vault, apy.inceptionBlockNumber))

    // both lookbacks land after inception, so both are sampled
    expect(apy.weeklyPricePerShare).to.not.equal(undefined)
    expect(apy.monthlyPricePerShare).to.not.equal(undefined)
    expect(apy.weeklyPricePerShare).to.equal(await readPps(vault, apy.weeklyBlockNumber))
    expect(apy.monthlyPricePerShare).to.equal(await readPps(vault, apy.monthlyBlockNumber))
  })
})
