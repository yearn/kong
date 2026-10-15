import { strict as assert } from 'node:assert'
import { describe, expect, it } from 'vitest'
import { buildASTSchema, concatAST, graphql, Kind, ObjectTypeDefinitionNode } from 'graphql'
import vault from './vault'
import typeDefs from './index'
import publisher from './fixtures/katana-publisher.json'

function fields(name: string) {
  const def = vault.definitions.find(
    (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === name
  )
  assert.ok(def, `missing type ${name}`)
  return Object.fromEntries(def.fields!.map(f => [f.name.value, f]))
}

describe('vault typeDefs', () => {
  it('exposes gross on EstimatedApr and the scope markers on components', () => {
    const estimated = fields('EstimatedApr')
    for (const key of ['apr', 'apy', 'grossAPR', 'grossAPY']) assert.ok(estimated[key], key)

    const components = fields('EstimatedAprComponents')
    for (const key of ['isStrategy', 'debtRatio', 'katRewardsAPR', 'compoundingPeriodsPerYear']) {
      assert.ok(components[key], key)
    }
    assert.equal(components.grossAPR, undefined, 'grossAPR is exposed only on EstimatedApr')
  })
})

const schema = buildASTSchema(concatAST(typeDefs))
const source = '{ vault { performance { estimated { components { katRewardsAPR estimatedDebtCoverage morphoBaseAPY morphoRewardsAPR } } } } }'

describe('Katana diagnostic fields', () => {
  it('serializes the published values, including zero coverage', async () => {
    const components = { katRewardsAPR: 0.023, estimatedDebtCoverage: 0, morphoBaseAPY: 0.041, morphoRewardsAPR: 0.019 }
    const result = await graphql({ schema, source,
      rootValue: { vault: { performance: { estimated: { type: 'katana-estimated-apr', components } } } } })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ vault: { performance: { estimated: { components } } } })
  })

  it('serializes the adapted publisher response contract', async () => {
    const components = { katRewardsAPR: null, ...Object.fromEntries(publisher.outputs.map(row => [row.component, row.value])) }
    const result = await graphql({ schema, source,
      rootValue: { vault: { performance: { estimated: { type: 'katana-estimated-apr', components } } } } })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ vault: { performance: { estimated: { components } } } })
  })

  it('keeps missing diagnostics nullable for existing publishers', async () => {
    const result = await graphql({ schema, source,
      rootValue: { vault: { performance: { estimated: { type: 'legacy', components: {} } } } } })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ vault: { performance: { estimated: { components: {
      katRewardsAPR: null, estimatedDebtCoverage: null, morphoBaseAPY: null, morphoRewardsAPR: null
    } } } } })
  })
})
