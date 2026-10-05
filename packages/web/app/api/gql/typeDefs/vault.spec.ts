import { describe, expect, it } from 'vitest'
import { buildASTSchema, concatAST, graphql } from 'graphql'
import typeDefs from './index'
import publisher from './fixtures/katana-publisher.json'

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

  it('serializes the independently recorded publisher response contract', async () => {
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
