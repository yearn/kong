import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { infoFor } from './requestedFields.fixture'
import { requestedFields } from './requestedFields'

describe('requestedFields', () => {
  it('returns plain top-level fields, not nested ones', () => {
    assert.deepEqual(requestedFields(infoFor('{ vaults { name apy { net } } }')), ['name', 'apy'])
  })

  it('uses the field name, not the alias', () => {
    assert.deepEqual(requestedFields(infoFor('{ vaults { label: name } }')), ['name'])
  })

  it('walks inline fragments', () => {
    assert.deepEqual(requestedFields(infoFor('{ vaults { name ... on Vault { symbol } } }')), ['name', 'symbol'])
  })

  it('walks named fragment spreads', () => {
    const info = infoFor('{ vaults { ...A } } fragment A on Vault { name ...B } fragment B on Vault { risk { label } }')
    assert.deepEqual(requestedFields(info), ['name', 'risk'])
  })

  it('merges selections across all field nodes', () => {
    assert.deepEqual(requestedFields(infoFor('{ vaults { name } vaults { symbol name } }')), ['name', 'symbol'])
  })
})
