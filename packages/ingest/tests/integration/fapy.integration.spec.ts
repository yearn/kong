import { expect } from 'chai'
import processFapy from '../../abis/yearn/3/vault/timeseries/fapy/hook'
import console from 'console'

describe('FAPY Integration', () => {
  it('calculation should match ydaemon', async () => {
    const VAULT_ADDRESS = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88'
    const CHAIN_ID = 1
    const ydaemonData = await fetch(`https://ydaemon.yearn.fi/1/vaults/${VAULT_ADDRESS}`)
    const ydaemonDataJson = await ydaemonData.json()
    const ydaemonAPY = ydaemonDataJson.apr.forwardAPR

    const fapyAPY = await processFapy(CHAIN_ID, VAULT_ADDRESS, {
      abiPath: 'yearn/3/vault',
      chainId: CHAIN_ID,
      address: VAULT_ADDRESS,
      outputLabel: 'fapy',
      blockTime: BigInt(Math.floor(Date.now() / 1000) - 3600)
    })

    const fapyValues = fapyAPY.reduce((acc, item) => {
      if(item.component) {
        acc[item.component] = item.value ?? 0
      }
      return acc
    }, {} as Record<string, number>)

    console.log('fapyValues', fapyValues)
    console.log('ydaemonAPY', ydaemonAPY)

    expect(fapyValues.forwardNetAPY).to.be.equal(ydaemonAPY.netAPR)
    expect(fapyValues.forwardBoost).to.be.equal(ydaemonAPY.composite.boost)
    expect(fapyValues.poolAPY).to.be.equal(ydaemonAPY.composite.poolAPY)
    expect(fapyValues.boostedAPR).to.be.equal(ydaemonAPY.composite.boostedAPR)
    expect(fapyValues.baseAPR).to.be.equal(ydaemonAPY.composite.baseAPR)
    expect(fapyValues.rewardsAPY).to.be.equal(ydaemonAPY.composite.rewardsAPR)
    expect(fapyValues.cvxAPR).to.be.equal(ydaemonAPY.composite.cvxAPR)
  })
})
