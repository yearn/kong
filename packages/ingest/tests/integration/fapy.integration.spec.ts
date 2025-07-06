import { expect } from 'chai'
import BigDecimal from 'js-big-decimal'
import processFapy from '../../abis/yearn/3/vault/timeseries/fapy/hook'

describe('FAPY Integration', () => {
  it('calculation should match ydaemon', async (done) => {
    const VAULT_ADDRESS = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88'
    const CHAIN_ID = 1
    const ydaemonData = await fetch(`https://ydaemon.yearn.fi/1/vaults/${VAULT_ADDRESS}`)
    const ydaemonDataJson = await ydaemonData.json()
    const ydaemonAPY = ydaemonDataJson.apr.forwardAPR

    const fapy = await processFapy(CHAIN_ID, VAULT_ADDRESS, {
      abiPath: 'yearn/3/vault',
      chainId: CHAIN_ID,
      address: VAULT_ADDRESS,
      outputLabel: 'fapy',
      blockTime: BigInt(Math.floor(Date.now() / 1000) - 3600)
    })

    const kongAPY = fapy.reduce((acc, curr) => {
      if(curr.component) {
        acc[curr.component] = curr.value ?? 0
      }
      return acc
    }, {} as Record<string, any>)


    expect(new BigDecimal(ydaemonAPY.netAPR.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.netAPR.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.boost.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.forwardBoost.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.poolAPY.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.poolAPY.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.boostedAPR.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.boostedAPR.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.baseAPR.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.baseAPR.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.cvxAPR.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.cvxAPR.toString()).round(2).getValue())
    expect(new BigDecimal(ydaemonAPY.composite.rewardsAPR.toString()).round(2).getValue()).to.be.equal(new BigDecimal(kongAPY.rewardsAPY.toString()).round(2).getValue())

    done()
  })
})
