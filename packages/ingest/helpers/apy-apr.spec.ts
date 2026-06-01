import { expect } from 'chai'
import db from '../db'
import { getLatestEstimatedAprV3 } from './apy-apr'

const TEST_CHAIN = 99999
const VAULT_ADDR = '0xtest_vault_apr_spec'
const LABEL = 'yvusd-estimated-apr'

async function insertOutput(address: string, label: string, component: string, value: number, blockTime: Date, blockNumber = 1) {
  await db.query(
    `INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [TEST_CHAIN, address, label, component, value, blockNumber, blockTime]
  )
}

async function cleanup() {
  await db.query('DELETE FROM output WHERE chain_id = $1', [TEST_CHAIN])
}

describe('getLatestEstimatedAprV3', function() {
  afterEach(cleanup)

  it('returns undefined when no rows exist', async function() {
    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.be.undefined
  })

  it('returns vault-level rows (no debtRatio) via fallback path', async function() {
    const t = new Date()
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.05, t)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.051, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.deep.equal({
      type: LABEL,
      apr: 0.05,
      apy: 0.051,
      components: {}
    })
  })

  it('skips block_time with debtRatio, returns older vault-level rows', async function() {
    const older = new Date(Date.now() - 60_000)
    const newer = new Date()

    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.04, older, 1)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.041, older, 1)

    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.08, newer, 2)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.082, newer, 2)
    await insertOutput(VAULT_ADDR, LABEL, 'debtRatio', 5000, newer, 2)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.apr).to.equal(0.04)
    expect(result!.apy).to.equal(0.041)
  })

  it('returns undefined when all block_times have debtRatio', async function() {
    const t = new Date()
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.08, t)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.082, t)
    await insertOutput(VAULT_ADDR, LABEL, 'debtRatio', 5000, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.be.undefined
  })

  it('explicit label path ignores debtRatio filter', async function() {
    const t = new Date()
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.08, t)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.082, t)
    await insertOutput(VAULT_ADDR, LABEL, 'debtRatio', 5000, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR, LABEL)
    expect(result).to.not.be.undefined
    expect(result!.apr).to.equal(0.08)
    expect(result!.apy).to.equal(0.082)
    expect(result!.components).to.deep.equal({ debtRatio: 5000 })
  })

  it('excludes rows older than 7 days', async function() {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.03, old)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.031, old)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.be.undefined
  })

  it('returns undefined when explicit label does not exist', async function() {
    const t = new Date()
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.05, t)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.051, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR, 'nonexistent-label')
    expect(result).to.be.undefined
  })

  it('picks latest block_time among multiple eligible labels in fallback', async function() {
    const older = new Date(Date.now() - 120_000)
    const newer = new Date(Date.now() - 60_000)
    const labelA = 'crv-estimated-apr'
    const labelB = 'yvusd-estimated-apr'

    await insertOutput(VAULT_ADDR, labelA, 'netAPR', 0.02, older)
    await insertOutput(VAULT_ADDR, labelA, 'netAPY', 0.021, older)

    await insertOutput(VAULT_ADDR, labelB, 'netAPR', 0.05, newer)
    await insertOutput(VAULT_ADDR, labelB, 'netAPY', 0.051, newer)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.type).to.equal(labelB)
    expect(result!.apr).to.equal(0.05)
  })

  it('skips newer block_time with debtRatio across different labels', async function() {
    const older = new Date(Date.now() - 120_000)
    const newer = new Date(Date.now() - 60_000)
    const labelA = 'crv-estimated-apr'
    const labelB = 'yvusd-estimated-apr'

    await insertOutput(VAULT_ADDR, labelA, 'netAPR', 0.02, older)

    await insertOutput(VAULT_ADDR, labelB, 'netAPR', 0.09, newer)
    await insertOutput(VAULT_ADDR, labelB, 'debtRatio', 1000, newer)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.type).to.equal(labelA)
    expect(result!.apr).to.equal(0.02)
  })

  it('does not merge debtRatio rows from another label at the selected block_time', async function() {
    const t = new Date()
    const labelA = 'crv-estimated-apr'
    const labelB = 'yvusd-estimated-apr'

    await insertOutput(VAULT_ADDR, labelA, 'netAPR', 0.02, t)
    await insertOutput(VAULT_ADDR, labelA, 'netAPY', 0.021, t)

    await insertOutput(VAULT_ADDR, labelB, 'netAPR', 0.09, t)
    await insertOutput(VAULT_ADDR, labelB, 'debtRatio', 1000, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.type).to.equal(labelA)
    expect(result!.apr).to.equal(0.02)
    expect(result!.components).to.deep.equal({})
  })

  it('different addresses do not interfere with each other', async function() {
    const t = new Date()
    const OTHER_ADDR = '0xother_address'
    await insertOutput(VAULT_ADDR, LABEL, 'netAPR', 0.05, t)
    await insertOutput(VAULT_ADDR, LABEL, 'netAPY', 0.051, t)

    await insertOutput(OTHER_ADDR, LABEL, 'netAPR', 0.99, t)
    await insertOutput(OTHER_ADDR, LABEL, 'netAPY', 0.999, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.apr).to.equal(0.05)
    expect(result!.apy).to.equal(0.051)
  })

  it('returns object with undefined apr/apy when rows lack netAPR/netAPY', async function() {
    const t = new Date()
    await insertOutput(VAULT_ADDR, LABEL, 'someOtherMetric', 0.05, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, VAULT_ADDR)
    expect(result).to.not.be.undefined
    expect(result!.apr).to.be.undefined
    expect(result!.apy).to.be.undefined
    expect(result!.components).to.deep.equal({ someOtherMetric: 0.05 })
  })

  it('does not return yvusd-estimated-apr for strategy vault that is also a vault (issue #409)', async function() {
    const t = new Date()
    const STRATEGY_VAULT = '0xstrategy_also_vault'

    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPR', 0.08, t)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPY', 0.082, t)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'debtRatio', 5000, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, STRATEGY_VAULT)
    expect(result).to.be.undefined
  })

  it('explicit label lookup still resolves for strategy vault with debtRatio (issue #409 composition path)', async function() {
    const t = new Date()
    const STRATEGY_VAULT = '0xstrategy_with_debtratio'

    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPR', 0.08, t)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPY', 0.082, t)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'debtRatio', 5000, t)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, STRATEGY_VAULT, 'yvusd-estimated-apr')
    expect(result).to.not.be.undefined
    expect(result!.apr).to.equal(0.08)
    expect(result!.apy).to.equal(0.082)
    expect(result!.components).to.deep.equal({ debtRatio: 5000 })
  })

  it('returns older vault-only block_time when latest has debtRatio and older has none (issue #409 exact scenario)', async function() {
    const older = new Date(Date.now() - 120_000)
    const newer = new Date()
    const STRATEGY_VAULT = '0xstrategy_older_clean'

    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPR', 0.03, older)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPY', 0.031, older)

    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPR', 0.15, newer)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'netAPY', 0.151, newer)
    await insertOutput(STRATEGY_VAULT, 'yvusd-estimated-apr', 'debtRatio', 9999, newer)

    const result = await getLatestEstimatedAprV3(TEST_CHAIN, STRATEGY_VAULT)
    expect(result).to.not.be.undefined
    expect(result!.type).to.equal('yvusd-estimated-apr')
    expect(result!.apr).to.equal(0.03)
    expect(result!.apy).to.equal(0.031)
    expect(result!.components).to.deep.equal({})
  })
})
