import { describe, expect, it } from 'vitest'
import { computeNetApr } from '../../../../lib/apy'

describe('abis/yearn/3/vault/timeseries/apr-oracle/hook', function() {
  it('re-exports computeNetApr from lib/apy', async function() {
    const { computeNetApr: reExported } = await import('./hook')
    expect(reExported).to.equal(computeNetApr)
  })
})
