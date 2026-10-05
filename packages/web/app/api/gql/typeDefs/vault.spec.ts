import { describe, expect, it } from 'vitest'
import { buildASTSchema, concatAST, graphql } from 'graphql'
import typeDefs from './index'

const schema = buildASTSchema(concatAST(typeDefs))
const source = '{ vault { performance { estimated { components { estimatedDebtCoverage morphoBaseAPY morphoRewardsAPR } } } } }'

describe('Katana diagnostic fields', () => {
  it('serializes the published values, including zero coverage', async () => {
    const components = { estimatedDebtCoverage: 0, morphoBaseAPY: 0.041, morphoRewardsAPR: 0.019 }
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
      estimatedDebtCoverage: null, morphoBaseAPY: null, morphoRewardsAPR: null
    } } } } })
  })
})
