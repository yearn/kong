import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import db, { toUpsertSql } from '../../../../../db'
import { getLatestApy, getLatestEstimatedApr, getLatestEstimatedAprV3 } from '../../../../../helpers/apy-apr'
import { extractLenderStatuses } from './hook'

describe('abis/yearn/2/strategy/snapshot/hook', function() {
  it('extracts lender statuses', async function() {
    const statuses = await extractLenderStatuses(mainnet.id, '0x2216E44fA633ABd2540dB72Ad34b42C7F1557cd4', 18530014n)
    expect(statuses).to.be.an('array')
    expect(statuses).to.have.length(2)
    expect(statuses[1]).to.deep.equal({
      name: 'GenericCompV3',
      assets: 1125403759558n,
      rate: 63939160081334480n,
      address: '0x2eD5eAf929Fee1F5F9B32d83dB8ed06b52692A74'
    })
  })

  it('extracts no lender statuses', async function() {
    const statuses = await extractLenderStatuses(mainnet.id, '0x120FA5738751b275aed7F7b46B98beB38679e093', 18530014n)
    expect(statuses).to.be.an('array')
    expect(statuses).to.have.length(0)
  })


  it('extracts estimated apr', async function() {
    const chainId = 1337
    const address = '0x1000000000000000000000000000000000000000'
    // must be recent: getLatestEstimatedApr filters block_time > NOW() - 7 days
    const blockTime = BigInt(Math.floor(Date.now() / 1000))
    const now = Number(blockTime)
    const blockNumber = 1000n

    const outputData = {
      chain_id: chainId,
      address,
      label: 'crv-estimated-apr',
      component: 'netAPR',
      value: 0.05,
      block_number: blockNumber,
      block_time: now,
      series_time: now
    }

    await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))

    const result = await getLatestEstimatedApr(chainId, address)
    expect(result).to.not.be.undefined
    expect(result?.type).to.equal('crv')
    expect(result?.apr).to.equal(0.05)
  })

  it('ignores vault-level v3 estimated apr rows with debt ratios', async function() {
    const chainId = 1337
    const address = '0x3000000000000000000000000000000000000003'
    const blockTime = BigInt(Math.floor(Date.now() / 1000))
    const blockNumber = blockTime

    for (const [component, value] of [['netAPR', 0.05], ['debtRatio', 1]]) {
      const outputData = {
        chain_id: chainId,
        address,
        label: 'foo-estimated-apr',
        component,
        value,
        block_number: blockNumber,
        block_time: Number(blockTime),
        series_time: Number(blockTime)
      }

      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const result = await getLatestEstimatedAprV3(chainId, address)
    expect(result).to.be.undefined
  })

  it('bounds getLatestApy to the lookback window', async function() {
    const chainId = 1337
    const address = '0x4444444444444444444444444444444444444444' // unique to this test, no cross-spec contamination
    const now = Math.floor(Date.now() / 1000)
    const stale = now - 30 * 24 * 60 * 60 // outside the default 7-day CURRENT_PERFORMANCE_LOOKBACK_DAYS window

    const apyRow = (component: string, value: number, time: number, blockNumber: bigint) => ({
      chain_id: chainId,
      address,
      label: 'apy-bwd-delta-pps',
      component,
      value,
      block_number: blockNumber,
      block_time: time,
      series_time: time
    })

    const upsert = (row: ReturnType<typeof apyRow>) =>
      db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', row), Object.values(row))

    // only a stale row exists -> outside window -> ignored
    await upsert(apyRow('net', 0.1, stale, 4001n))
    expect(await getLatestApy(chainId, address)).to.be.undefined

    // add an in-window row -> returned, proving the undefined above was the window bound
    await upsert(apyRow('net', 0.2, now, 4002n))
    const result = await getLatestApy(chainId, address)
    expect(result).to.not.be.undefined
    expect(result?.net).to.equal(0.2)
  })
})
