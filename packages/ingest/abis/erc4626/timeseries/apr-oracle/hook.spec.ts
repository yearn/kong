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
    const { apr, currentApr } = await readApr(mainnet.id, morphoUsdt, 25211174n, oracle!.address)
    expect(apr).to.be.closeTo(0.11878347712984644, 1e-6)
    // getStrategyApr succeeds, so the fallback never runs and currentApr stays undefined.
    expect(currentApr).to.equal(undefined)
  })

  it('returns nothing when the chain has no oracle configured', async function() {
    const data: Data = {
      abiPath: 'erc4626', chainId: 999999, address: morphoUsdt,
      outputLabel, blockTime: BigInt(Math.floor(Date.now() / 1000))
    }
    expect(await hook(999999, morphoUsdt, data)).to.deep.equal([])
  })

  it('emits apr/apy, plus currentApr/currentApy when the oracle returns a current apr', async function() {
    const data: Data = {
      abiPath: 'erc4626', chainId: mainnet.id, address: morphoUsdt,
      outputLabel, blockTime: BigInt(Math.floor(Date.now() / 1000)) + 60n
    }
    const outputs = await hook(mainnet.id, morphoUsdt, data)
    const components = outputs.map(o => o.component)
    // net* stays v3-only; erc4626 emits apr/apy and optionally currentApr/currentApy.
    expect(components).to.include.members(['apr', 'apy'])
    expect(components.every(c => ['apr', 'apy', 'currentApr', 'currentApy'].includes(c))).to.equal(true)
    expect(outputs.every(o => o.label === outputLabel)).to.equal(true)

    const value = (component: string) => outputs.find(o => o.component === component)?.value as number | undefined
    expect(value('apr')!).to.be.greaterThan(0)
    expect(value('apy')!).to.be.closeTo(computeApy(value('apr')!), 1e-9)

    // currentApr/currentApy travel as a pair with the same apy relationship.
    const currentApr = value('currentApr')
    expect(components.includes('currentApy')).to.equal(currentApr !== undefined)
    if (currentApr !== undefined) {
      expect(value('currentApy')!).to.be.closeTo(computeApy(currentApr), 1e-9)
    }
  })
})
