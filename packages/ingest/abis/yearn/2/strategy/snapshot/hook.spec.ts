import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import { extractLenderStatuses } from './hook'
import { getLatestEstimatedApr } from '../../../../../helpers/apy-apr'
import db, { toUpsertSql } from '../../../../../db'

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
    const blockTime = 1000n
    const blockNumber = 1000n

    const outputData = {
      chain_id: chainId,
      address,
      label: 'crv-estimated-apr',
      component: 'netAPR',
      value: 0.05,
      block_number: blockNumber,
      block_time: Number(blockTime),
      series_time: Number(blockTime)
    }

    await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))

    const result = await getLatestEstimatedApr(chainId, address)
    expect(result).to.not.be.undefined
    expect(result?.type).to.equal('crv')
    expect(result?.apr).to.equal(0.05)
  })
})
