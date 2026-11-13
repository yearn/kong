import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ poolsCreated: 0 }))

vi.mock('pg', async importOriginal => {
  const actual = await importOriginal<typeof import('pg')>()
  const PoolSpy = class PoolSpy extends actual.Pool {
    constructor(...args: ConstructorParameters<typeof actual.Pool>) {
      state.poolsCreated += 1
      super(...args)
    }
  }

  return {
    ...actual,
    default: { ...actual, Pool: PoolSpy },
    Pool: PoolSpy,
  }
})

vi.mock('@redis/client', () => ({
  createClient: () => { throw new Error('Redis client was constructed during bundle import') },
}))

vi.mock('@keyv/redis', () => ({
  createKeyv: () => { throw new Error('Keyv Redis client was constructed during bundle import') },
}))

describe('standalone entrypoint imports', () => {
  afterEach(() => {
    vi.resetModules()
    state.poolsCreated = 0
  })

  it('does not construct PostgreSQL or Redis pools before a request', async () => {
    const { default: handler } = await import('../src/index.js')
    const response = await handler.fetch(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(state.poolsCreated).toBe(0)
  })
})
