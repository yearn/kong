import { expect } from 'chai'
import { classifyVault } from './classify-vault'

describe('classifyVault', function() {
  it('marks v3 true for 3.0.2', function() {
    expect(classifyVault('3.0.2')).to.deep.equal({ yearn: true, v3: true, apiVersion: '3.0.2' })
  })

  it('marks v3 true for 3.0.0', function() {
    expect(classifyVault('3.0.0')).to.deep.equal({ yearn: true, v3: true, apiVersion: '3.0.0' })
  })

  it('marks v3 true for 10.0.0', function() {
    expect(classifyVault('10.0.0')).to.deep.equal({ yearn: true, v3: true, apiVersion: '10.0.0' })
  })

  it('marks v3 false for 0.4.6', function() {
    expect(classifyVault('0.4.6')).to.deep.equal({ yearn: true, v3: false, apiVersion: '0.4.6' })
  })

  it('returns the cleaned version so downstream compare() cannot throw', function() {
    expect(classifyVault('v3.0.2')).to.deep.equal({ yearn: true, v3: true, apiVersion: '3.0.2' })
    expect(classifyVault('0.4.6-beta')).to.deep.equal({ yearn: true, v3: false, apiVersion: '0.4.6' })
    expect(classifyVault('3.0.2rc')).to.deep.equal({ yearn: true, v3: true, apiVersion: '3.0.2' })
  })

  it('returns undefined for unparseable input without throwing', function() {
    expect(() => classifyVault('yVault')).to.not.throw()
    expect(classifyVault('yVault')).to.equal(undefined)
    expect(classifyVault('abc')).to.equal(undefined)
  })

  it('returns undefined for empty or missing input without throwing', function() {
    expect(() => classifyVault(undefined)).to.not.throw()
    expect(classifyVault(undefined)).to.equal(undefined)
    expect(classifyVault('')).to.equal(undefined)
  })
})
