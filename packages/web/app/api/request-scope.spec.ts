import { strict as assert } from 'node:assert'
import { delegate, perRequest } from './request-scope'

const CONTEXT = Symbol.for('__cloudflare-context__')

function inRequest<T>(ctx: object, run: () => T): T {
  const global = globalThis as Record<symbol, unknown>
  global[CONTEXT] = { env: {}, cf: {}, ctx }
  try {
    return run()
  } finally {
    delete global[CONTEXT]
  }
}

describe('perRequest', () => {
  it('shares one instance outside a Workers request', () => {
    const current = perRequest(() => ({}))
    assert.equal(current(), current())
  })

  it('gives each Workers request its own instance and reuses it within the request', () => {
    const current = perRequest(() => ({}))
    const first = inRequest({}, () => [current(), current()])
    const second = inRequest({}, () => current())

    assert.equal(first[0], first[1])
    assert.notEqual(first[0], second)
    assert.notEqual(first[0], current())
  })
})

describe('delegate', () => {
  it('forwards calls to the instance of the current request', () => {
    let created = 0
    const client = delegate(perRequest(() => {
      const id = created++
      return { id: () => id }
    }))

    assert.equal(client.id(), 0)
    assert.equal(inRequest({}, () => client.id()), 1)
    assert.equal(client.id(), 0)
  })
})
