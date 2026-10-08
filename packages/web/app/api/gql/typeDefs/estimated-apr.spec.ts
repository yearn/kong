import { describe, expect, it } from 'vitest'
import { buildASTSchema, concatAST, graphql } from 'graphql'
import typeDefs from './index'

const schema = buildASTSchema(concatAST(typeDefs))

describe('estimated APR gross fields', () => {
  it('serves gross estimates at the promoted GraphQL fields', async () => {
    const result = await graphql({ schema,
      source: '{ vault { performance { estimated { apr grossAPR grossAPY } } } }',
      rootValue: { vault: { performance: { estimated: {
        type: 'publisher-estimated-apr', apr: 0.05, grossAPR: 0.07, grossAPY: 0.072, components: {}
      } } } }
    })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ vault: { performance: { estimated: { apr: 0.05, grossAPR: 0.07, grossAPY: 0.072 } } } })
  })
  it('rejects the removed components.grossAPR selection rather than silently returning null', async () => {
    const result = await graphql({ schema, source: '{ vault { performance { estimated { components { grossAPR } } } } }' })
    expect(result.errors?.[0].message).toContain('Cannot query field "grossAPR" on type "EstimatedAprComponents"')
  })
})
