import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { Kind, ObjectTypeDefinitionNode } from 'graphql'
import vault from './vault'

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
    const deprecated = components.grossAPR.directives?.find(d => d.name.value === 'deprecated')
    assert.ok(deprecated, 'components.grossAPR should be @deprecated')
  })
})
