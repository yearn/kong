import { expect } from 'chai'
import { extractVersion } from './compare'

describe('extractVersion', () => {
  it('should extract version numbers correctly', () => {
    expect(extractVersion('0.3.3.Edited')).to.equal('0.3.3')
    expect(extractVersion('1.2.3')).to.equal('1.2.3')
    expect(extractVersion('2.4')).to.equal('2.4')
    expect(extractVersion('3')).to.equal('3')
    expect(extractVersion('4.5.6.7.8')).to.equal('4.5.6')
    expect(extractVersion('1.2.3-alpha')).to.equal('1.2.3')
    expect(extractVersion('v2.3.4')).to.equal('2.3.4')
  })

  it('should return "0" for invalid versions', () => {
    expect(extractVersion('Invalid')).to.equal('0')
    expect(extractVersion('')).to.equal('0')
    expect(extractVersion('a.b.c')).to.equal('0')
  })
})
