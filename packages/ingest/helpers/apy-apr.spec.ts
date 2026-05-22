import { expect } from 'chai'
import db from '../db'
import { getLatestEstimatedAprV3 } from './apy-apr'

const chainId = 1
const vault = '0x696d02Db93291651ED510704c9b286841d506987'      // yvUSD
const strategy = '0x0e297dE4005883C757c9F09fdF7cF1363C20e626'   // OG USDC Compounder (also a v3 vault)
const label = 'yvusd-estimated-apr'

async function insertOutput(
  address: string,
  rows: { component: string, value: number }[],
  blockNumber: number,
  blockTime: Date
) {
  for (const row of rows) {
    await db.query(`
      INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
    `, [chainId, address, label, row.component, row.value, blockNumber, blockTime])
  }
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

describe('helpers/apy-apr', function () {
  this.timeout(20_000)

  beforeEach(async function () {
    await db.query('DELETE FROM output WHERE address = ANY($1) AND label = $2', [[vault, strategy], label])
  })

  afterEach(async function () {
    await db.query('DELETE FROM output WHERE address = ANY($1) AND label = $2', [[vault, strategy], label])
  })

  describe('getLatestEstimatedAprV3 (no-label fallback)', function () {
    it('returns yvusd-estimated-apr for vault rows (no debtRatio component)', async function () {
      await insertOutput(vault, [
        { component: 'netAPR', value: 0.07 },
        { component: 'netAPY', value: 0.0725 }
      ], 24300000, hoursAgo(1))

      const result = await getLatestEstimatedAprV3(chainId, vault)

      expect(result).to.not.be.undefined
      expect(result!.type).to.eq('yvusd-estimated-apr')
      expect(result!.apr).to.eq(0.07)
      expect(result!.apy).to.eq(0.0725)
    })

    it('returns undefined for strategy rows tagged with debtRatio component (leak guard)', async function () {
      await insertOutput(strategy, [
        { component: 'netAPR', value: 0.05 },
        { component: 'netAPY', value: 0.0512 },
        { component: 'debtRatio', value: 5000 }
      ], 24300001, hoursAgo(1))

      const result = await getLatestEstimatedAprV3(chainId, strategy)

      expect(result).to.be.undefined
    })

    it('skips debtRatio-tagged block_times but still picks an older clean block_time if present', async function () {
      // older clean vault-shape row
      await insertOutput(strategy, [
        { component: 'netAPR', value: 0.04 },
        { component: 'netAPY', value: 0.0408 }
      ], 24299000, hoursAgo(2))

      // newer leaked strategy-shape row (debtRatio present) — must be excluded
      await insertOutput(strategy, [
        { component: 'netAPR', value: 0.05 },
        { component: 'netAPY', value: 0.0512 },
        { component: 'debtRatio', value: 5000 }
      ], 24300001, hoursAgo(1))

      const result = await getLatestEstimatedAprV3(chainId, strategy)

      expect(result).to.not.be.undefined
      expect(result!.apr).to.eq(0.04)
      expect(result!.apy).to.eq(0.0408)
    })

    it('label-scoped query (explicit label arg) remains unaffected — picks the latest regardless of debtRatio', async function () {
      await insertOutput(strategy, [
        { component: 'netAPR', value: 0.05 },
        { component: 'netAPY', value: 0.0512 },
        { component: 'debtRatio', value: 5000 }
      ], 24300001, hoursAgo(1))

      const result = await getLatestEstimatedAprV3(chainId, strategy, label)

      expect(result).to.not.be.undefined
      expect(result!.type).to.eq(label)
      expect(result!.apr).to.eq(0.05)
      expect(result!.components.debtRatio).to.eq(5000)
    })
  })
})
