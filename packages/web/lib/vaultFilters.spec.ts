import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { buildVaultFilters } from './vaultFilters'

describe('buildVaultFilters', () => {
  it('defaults to label filter only', () => {
    const { where, params } = buildVaultFilters({})
    assert.equal(where, 'thing.label = $1')
    assert.deepEqual(params, ['vault'])
  })

  it('numbers params in order', () => {
    const { where, params } = buildVaultFilters({ chainId: 1, vaultType: 2, riskLevel: 3 })
    assert.match(where, /thing\.chain_id = \$2/)
    assert.match(where, /'vaultType'.*= \$3/)
    assert.match(where, /BETWEEN 1 AND \$4/)
    assert.deepEqual(params, ['vault', 1, 2, 3])
  })

  it('lowercases valid addresses and drops invalid ones', () => {
    const { where, params } = buildVaultFilters({ addresses: ['0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD', 'nope'] })
    assert.match(where, /lower\(thing\.address\) = ANY\(\$2\)/)
    assert.deepEqual(params, ['vault', ['0xabcdefabcdefabcdefabcdefabcdefabcdefabcd']])
  })

  it('drops 0x-prefixed non-addresses without throwing', () => {
    const { where, params } = buildVaultFilters({ addresses: ['0xdead'] })
    assert.match(where, /lower\(thing\.address\) = ANY\(\$2\)/)
    assert.deepEqual(params, ['vault', []])
  })

  it('yearn and origin=yearn share the isYearn clause', () => {
    const a = buildVaultFilters({ yearn: true })
    const b = buildVaultFilters({ origin: 'yearn' })
    assert.equal(a.where, b.where)
    assert.match(a.where, /'yearn'\)::boolean, false\) OR .*'origin'\) = 'yearn'\)/)
    assert.deepEqual(a.params, ['vault'])
  })

  it('yearn=false negates', () => {
    const { where } = buildVaultFilters({ yearn: false })
    assert.match(where, /NOT COALESCE.*IS DISTINCT FROM 'yearn'/)
  })

  it('non-yearn origin is parameterized', () => {
    const { where, params } = buildVaultFilters({ origin: 'morpho' })
    assert.match(where, /'origin'\) = \$2/)
    assert.deepEqual(params, ['vault', 'morpho'])
  })

  it('unratedOnly wins over riskLevel', () => {
    const { where, params } = buildVaultFilters({ unratedOnly: true, riskLevel: 3 })
    assert.match(where, /riskLevel'\)::numeric, 0\) = 0/)
    assert.doesNotMatch(where, /BETWEEN/)
    assert.deepEqual(params, ['vault'])
  })

  it('apiVersion captures the whole version, not just the major', () => {
    const { where } = buildVaultFilters({ apiVersion: '0.4.6' })
    // a non-greedy prefix makes the whole RE non-greedy in postgres: '3.0.4' captured as '3'
    assert.doesNotMatch(where, /\*\?/)
    assert.match(where, /\^\[a-zA-Z\]\*\(/)
  })

  it('apiVersion compares padded int arrays on both sides', () => {
    const { where, params } = buildVaultFilters({ apiVersion: '3.0' })
    assert.match(where, /'apiVersion'\) from .*\[1:3\] >= \(string_to_array.*\$2.*\[1:3\]/)
    assert.deepEqual(params, ['vault', '3.0'])
  })
})
