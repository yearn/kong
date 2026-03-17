import { expect } from 'chai'
import { computeNetApr } from './hook'

describe('abis/yearn/3/vault/timeseries/apr-oracle/hook', function() {
  it('returns gross APR when fees are zero', function() {
    expect(computeNetApr(0.10, { management: 0, performance: 0 })).to.equal(0.10)
  })

  it('correctly applies performance and management fees', function() {
    // grossApr=0.10, management=0.02, performance=0.20
    // netApr = (0.10 - 0.02) * (1 - 0.20) = 0.08 * 0.80 = 0.064
    expect(computeNetApr(0.10, { management: 0.02, performance: 0.20 })).to.be.closeTo(0.064, 1e-10)
  })

  it('returns zero when performance fee is 100%', function() {
    expect(computeNetApr(0.10, { management: 0, performance: 1.0 })).to.equal(0)
  })

  it('handles zero gross APR', function() {
    expect(computeNetApr(0, { management: 0, performance: 0.20 })).to.equal(0)
  })

  it('handles no strategies (zero fees)', function() {
    expect(computeNetApr(0.05, { management: 0, performance: 0 })).to.equal(0.05)
  })
})
