import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { connect, q, reserveDiscoveryRepair, finishDiscoveryRepair, down } from './mq'

const chainId = 31337
const addresses = ['0xAa', '0xBb']
const key = (address: string) => `kong:discovery-repair:${chainId}:${address.toLowerCase()}`
const budget = 'kong:discovery-repair:global-budget'
const queue = connect(q.fanout)
let client: Awaited<typeof queue.client>

// vitest.global.ts provides an isolated container Redis, never deployment Redis.
describe('discovery repair Lua admission', () => {
  beforeAll(async () => { client = await queue.client; await client.del(budget, ...addresses.map(key)) })
  afterEach(async () => { await client.del(budget, ...addresses.map(key)) })
  afterAll(async () => { await queue.close(); await down() })

  it('admits one vault and budgets the next, then persists a successful cooldown', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0])
    expect(first.status).toBe('granted')
    expect((await reserveDiscoveryRepair(chainId, addresses[1])).status).toBe('budget')
    expect(await client.ttl(budget)).toBeGreaterThan(890)
    await finishDiscoveryRepair(chainId, addresses[0], first.token, true)
    expect(await client.get(key(addresses[0]))).toBe('done')
    expect(await client.ttl(key(addresses[0]))).toBeGreaterThan(86_390)
    expect((await reserveDiscoveryRepair(chainId, addresses[0])).status).toBe('cooldown')
  })

  it('releases a failed vault while keeping the global budget', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0])
    await finishDiscoveryRepair(chainId, addresses[0], first.token, false)
    expect(await client.exists(key(addresses[0]))).toBe(0)
    expect((await reserveDiscoveryRepair(chainId, addresses[0])).status).toBe('budget')
    expect(await client.exists(budget)).toBe(1)
  })

  it('does not let a stale token finish or release a newer reservation', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0])
    await client.del(budget, key(addresses[0])) // simulate expired admission window
    const newer = await reserveDiscoveryRepair(chainId, addresses[0])
    expect(newer.status).toBe('granted')
    await finishDiscoveryRepair(chainId, addresses[0], first.token, true)
    await finishDiscoveryRepair(chainId, addresses[0], first.token, false)
    expect(await client.get(key(addresses[0]))).toBe(newer.token)
    expect(await client.ttl(key(addresses[0]))).toBeGreaterThan(890)
  })
})
