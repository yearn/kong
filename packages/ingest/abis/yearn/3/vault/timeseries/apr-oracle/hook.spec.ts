import { expect } from 'chai'
import { vi } from 'vitest'
import { rpcs } from 'lib/rpcs'
import { ContractFunctionRevertedError } from 'viem'
import { computeApy, computeNetApr } from '../../../../lib/apy'
import { buildOracleComponents, readApr, readCurrentApr } from './hook'
import { V3_ORACLE_ABI } from './abi'

describe('abis/yearn/3/vault/timeseries/apr-oracle/hook', function() {
  const vault = '0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1' as const
  const oracle = '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92' as const
  const fees = { management: 0.02, performance: 0.1 }

  afterEach(function() {
    vi.restoreAllMocks()
  })

  it('re-exports computeNetApr from lib/apy', async function() {
    const { computeNetApr: reExported } = await import('./hook')
    expect(reExported).to.equal(computeNetApr)
  })

  describe('buildOracleComponents', function() {
    it('emits resolved apr/apy/netApr/netApy plus current* when current apr is present', function() {
      const apr = 0.1
      const currentApr = 0.2
      const components = buildOracleComponents(apr, fees, currentApr)

      expect(components.map(c => c.component).sort()).to.deep.equal(
        ['apr', 'apy', 'currentApr', 'currentApy', 'currentNetApr', 'currentNetApy', 'netApr', 'netApy']
      )

      const value = (component: string) => components.find(c => c.component === component)!.value
      expect(value('apr')).to.equal(apr)
      expect(value('apy')).to.equal(computeApy(apr))
      expect(value('netApr')).to.equal(computeNetApr(apr, fees))
      expect(value('netApy')).to.equal(computeApy(computeNetApr(apr, fees)))

      expect(value('currentApr')).to.equal(currentApr)
      expect(value('currentApy')).to.equal(computeApy(currentApr))
      expect(value('currentNetApr')).to.equal(computeNetApr(currentApr, fees))
      expect(value('currentNetApy')).to.equal(computeApy(computeNetApr(currentApr, fees)))
    })

    it('keeps the resolved output when current apr is missing (getCurrentApr failure)', function() {
      const apr = 0.1
      const components = buildOracleComponents(apr, fees, undefined)

      expect(components.map(c => c.component).sort()).to.deep.equal(['apr', 'apy', 'netApr', 'netApy'])
      expect(components.find(c => c.component === 'apr')!.value).to.equal(apr)
      expect(components.some(c => c.component.startsWith('current'))).to.equal(false)
    })
  })

  describe('readCurrentApr', function() {
    it('parses the oracle getCurrentApr value', async function() {
      vi.spyOn(rpcs, 'next').mockReturnValue(
        { readContract: async () => 5n * 10n ** 16n } as never
      )
      const apr = await readCurrentApr(1, vault, 100n, oracle)
      expect(apr).to.equal(0.05)
    })

    it('returns undefined when getCurrentApr reverts', async function() {
      vi.spyOn(rpcs, 'next').mockReturnValue(
        { readContract: async () => { throw new Error('reverted') } } as never
      )
      expect(await readCurrentApr(1, vault, 100n, oracle)).to.equal(undefined)
    })
  })

  describe('readApr', function() {
    it('returns the strategy apr and no currentApr when getStrategyApr succeeds', async function() {
      vi.spyOn(rpcs, 'next').mockReturnValue(
        { readContract: async (params: { functionName: string }) => {
          expect(params.functionName).to.equal('getStrategyApr')
          return 8n * 10n ** 16n
        } } as never
      )
      // strategy path: currentApr left undefined (the export reads it separately)
      expect(await readApr(1, vault, 100n, oracle)).to.deep.equal({ apr: 0.08, currentApr: undefined })
    })

    it('falls back to getCurrentApr when getStrategyApr reverts, and reports it as currentApr', async function() {
      const revert = new ContractFunctionRevertedError({
        abi: V3_ORACLE_ABI, functionName: 'getStrategyApr', message: 'reverted'
      })
      vi.spyOn(rpcs, 'next').mockReturnValue(
        { readContract: async (params: { functionName: string }) => {
          if (params.functionName === 'getStrategyApr') throw revert
          if (params.functionName === 'getCurrentApr') return 3n * 10n ** 16n
          throw new Error(`unexpected call: ${params.functionName}`)
        } } as never
      )
      // fallback path: resolved apr IS getCurrentApr, surfaced as currentApr to reuse
      expect(await readApr(1, vault, 100n, oracle)).to.deep.equal({ apr: 0.03, currentApr: 0.03 })
    })
  })
})
