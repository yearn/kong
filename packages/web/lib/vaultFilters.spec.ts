import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { buildVaultFilters } from './vaultFilters'

describe('buildVaultFilters', () => {
  it('defaults to label filter only', () => {
    const { where, params } = buildVaultFilters({})
    assert.equal(where, 'thing.label = $1')
    assert.deepEqual(params, ['vault'])
  })

  it('treats an explicit null chainId like an omitted chainId', () => {
    const omitted = buildVaultFilters({})
    const nullable = buildVaultFilters({ chainId: null })
    assert.equal(nullable.where, omitted.where)
    assert.deepEqual(nullable.params, omitted.params)
  })

  it('treats every explicit null filter like an omitted filter', () => {
    const omitted = buildVaultFilters({})
    const nullable = buildVaultFilters({
      apiVersion: null, erc4626: null, v3: null, yearn: null, origin: null,
      addresses: null, vaultType: null, riskLevel: null, unratedOnly: null
    })
    assert.equal(nullable.where, omitted.where)
    assert.deepEqual(nullable.params, omitted.params)
  })

  it('filters risk on the same merged blob the resolver serves', () => {
    const { where } = buildVaultFilters({ riskLevel: 3 })
    assert.match(where, /COALESCE\(thing\.defaults.*->'risk'\)->'riskLevel' BETWEEN to_jsonb\(1\) AND to_jsonb\(\$2::numeric\)/)
    assert.doesNotMatch(where, /snapshot\.hook->'risk'/)
  })

  it('compares jsonb without text casts', () => {
    const { where } = buildVaultFilters({ erc4626: true, v3: true, yearn: true, vaultType: 1, riskLevel: 2 })
    assert.doesNotMatch(where, /\)::boolean/)
    assert.doesNotMatch(where, /->>'vaultType'/)
    assert.doesNotMatch(where, /->>'riskLevel'/)
  })

  it('matches vaultType as jsonb number or jsonb string', () => {
    const { where, params } = buildVaultFilters({ vaultType: 1 })
    assert.match(where, /COALESCE\(.*, '0'::jsonb\) IN \(to_jsonb\(\$2::numeric\), to_jsonb\(\$2::text\)\)/)
    assert.doesNotMatch(where, /->'vaultType'\)::numeric/)
    assert.deepEqual(params, ['vault', 1])
  })

  it('numbers params in order', () => {
    const { where, params } = buildVaultFilters({ chainId: 1, vaultType: 2, riskLevel: 3 })
    assert.match(where, /thing\.chain_id = \$2/)
    assert.match(where, /'vaultType'\).*to_jsonb\(\$3::numeric\)/)
    assert.match(where, /BETWEEN to_jsonb\(1\) AND to_jsonb\(\$4::numeric\)/)
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
    assert.match(a.where, /'yearn'\) = to_jsonb\(true\)\) IS TRUE OR .*'origin'\) = 'yearn'\)/)
    assert.deepEqual(a.params, ['vault'])
  })

  it('yearn=false negates', () => {
    const { where } = buildVaultFilters({ yearn: false })
    assert.match(where, /NOT \(.*'yearn'\) = to_jsonb\(true\)\) IS TRUE OR .*IS DISTINCT FROM 'yearn'/)
  })

  it('non-yearn origin is parameterized', () => {
    const { where, params } = buildVaultFilters({ origin: 'morpho' })
    assert.match(where, /'origin'\) = \$2/)
    assert.deepEqual(params, ['vault', 'morpho'])
  })

  it('unratedOnly wins over riskLevel', () => {
    const { where, params } = buildVaultFilters({ unratedOnly: true, riskLevel: 3 })
    assert.match(where, /'riskLevel', '0'::jsonb\) = to_jsonb\(0\)/)
    assert.doesNotMatch(where, /BETWEEN/)
    assert.deepEqual(params, ['vault'])
  })

  it('apiVersion captures the whole version, not just the major', () => {
    const { where } = buildVaultFilters({ apiVersion: '0.4.6' })
    // a non-greedy prefix makes the whole RE non-greedy in postgres: '3.0.4' captured as '3'
    assert.doesNotMatch(where, /\*\?/)
    assert.match(where, /\^\[a-zA-Z\]\*\(/)
  })

  it('apiVersion compares padded numeric arrays on both sides', () => {
    const { where, params } = buildVaultFilters({ apiVersion: '3.0' })
    assert.match(where, /'apiVersion'\) from .*\[1:3\] >= \(string_to_array.*\$2.*\[1:3\]/)
    assert.deepEqual(params, ['vault', '3.0'])
  })
})
