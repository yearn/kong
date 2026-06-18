import { expect } from 'chai'
import { mainnet } from 'viem/chains'
import hook, { outputLabel } from './hook'
import { Data } from '../../../../extract/timeseries'
import { computeApy } from '../../../yearn/lib/apy'
import { readApr } from '../../../yearn/3/vault/timeseries/apr-oracle/hook'
import { getOracleConfig } from '../../../yearn/3/vault/timeseries/apr-oracle/constants'

describe('abis/erc4626/timeseries/apr-oracle/hook', function() {
  const morphoUsdt = '0x0963232eB842BAF53E8e517691f81745C1F228a0' as const

  it('prices a plain erc4626 vault via the apr oracle', async function() {
    // 0x0963 is a bare ERC4626 (no apiVersion/pricePerShare), so it lands on the
    // erc4626 path. The oracle still prices it via getStrategyApr.
    const oracle = getOracleConfig(mainnet.id)
    expect(oracle).to.not.equal(undefined)
    const read = await readApr(mainnet.id, morphoUsdt, 25211174n, oracle!.address)
    expect(read?.apr).to.be.closeTo(0.11878347712984644, 1e-6)
    expect(read?.source).to.equal('getStrategyApr')
  })

  it('returns nothing when the chain has no oracle configured', async function() {
    const data: Data = {
      abiPath: 'erc4626', chainId: 999999, address: morphoUsdt,
      outputLabel, blockTime: BigInt(Math.floor(Date.now() / 1000))
    }
    expect(await hook(999999, morphoUsdt, data)).to.deep.equal([])
  })

  it('emits apr and apy outputs', async function() {
    const data: Data = {
      abiPath: 'erc4626', chainId: mainnet.id, address: morphoUsdt,
      outputLabel, blockTime: BigInt(Math.floor(Date.now() / 1000)) + 60n
    }
    const outputs = await hook(mainnet.id, morphoUsdt, data)
    expect(outputs.map(o => o.component).sort()).to.deep.equal(['apr', 'apy', 'source:getStrategyApr'])
    expect(outputs.every(o => o.label === outputLabel)).to.equal(true)

    const apr = outputs.find(o => o.component === 'apr')!.value as number
    const apy = outputs.find(o => o.component === 'apy')!.value as number
    expect(apr).to.be.greaterThan(0)
    expect(apy).to.be.closeTo(computeApy(apr), 1e-9)
    expect(outputs.find(o => o.component === 'source:getStrategyApr')!.value).to.equal(1)
  })
})
