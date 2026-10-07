import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { connect, q, reserveDiscoveryRepair, finishDiscoveryRepair, confirmDiscoveryRepair, claimDiscoveryGapCheck, down } from './mq'

const chainId = 31337
const addresses = ['0xAa', '0xBb']
const key = (address: string) => `kong:discovery-repair:${chainId}:${address.toLowerCase()}`
const gate = (address: string) => `kong:discovery-gap:${chainId}:${address.toLowerCase()}`
const budget = 'kong:discovery-repair:global-budget'
const admissionKeys = [budget, 'kong:discovery-repair:first-pending', 'kong:discovery-repair:retry-pending', 'kong:discovery-repair:admitted']
const queue = connect(q.fanout)
let client: Awaited<typeof queue.client>

// vitest.global.ts provides an isolated container Redis, never deployment Redis.
describe('discovery repair Lua admission', () => {
  beforeAll(async () => { client = await queue.client; await client.del(...admissionKeys, ...addresses.map(key), ...addresses.map(gate)) })
  afterEach(async () => { await client.del(...admissionKeys, ...addresses.map(key), ...addresses.map(gate)) })
  afterAll(async () => { await queue.close(); await down() })

  it('admits one vault and budgets the next, then persists a successful cooldown', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0], 100n)
    expect(first.status).toBe('granted')
    expect((await reserveDiscoveryRepair(chainId, addresses[1])).status).toBe('budget')
    expect(await client.ttl(budget)).toBeGreaterThan(890)
    await finishDiscoveryRepair(chainId, addresses[0], first.token, true)
    expect(await client.get(key(addresses[0]))).toBe(`enqueued:${first.token}`)
    expect(await client.ttl(key(addresses[0]))).toBeGreaterThan(3590)
    expect(await confirmDiscoveryRepair(chainId, addresses[0], 99n)).toBe(0)
    expect(await confirmDiscoveryRepair(chainId, addresses[0], 100n)).toBe(1)
    expect(await client.get(key(addresses[0]))).toBe('done')
    expect(await client.ttl(key(addresses[0]))).toBeGreaterThan(86_390)
    expect((await reserveDiscoveryRepair(chainId, addresses[0])).status).toBe('cooldown')
  })

  it('retries an unconfirmed enqueue after the fixed window instead of locking it for a day', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0], 100n)
    await finishDiscoveryRepair(chainId, addresses[0], first.token, true)
    expect(await client.ttl(key(addresses[0]))).toBeLessThanOrEqual(3600)
    await client.expire(key(addresses[0]), 0)
    await client.expire(budget, 0)
    expect((await reserveDiscoveryRepair(chainId, addresses[0], 100n)).status).toBe('granted')
  })

  it('prefers a first repair over an unconfirmed retry', async () => {
    const first = await reserveDiscoveryRepair(chainId, addresses[0], 100n)
    await finishDiscoveryRepair(chainId, addresses[0], first.token, true)
    expect((await reserveDiscoveryRepair(chainId, addresses[1], 100n)).status).toBe('budget')
    await client.del(budget, key(addresses[0]))
    expect((await reserveDiscoveryRepair(chainId, addresses[0], 100n)).status).toBe('fairness')
    expect((await reserveDiscoveryRepair(chainId, addresses[1], 100n)).status).toBe('granted')
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
    expect(await client.ttl(key(addresses[0]))).toBeGreaterThan(3590)
  })

  it('claims one gap check per window and none while a repair holds the vault', async () => {
    expect(await claimDiscoveryGapCheck(chainId, addresses[0])).toBe(true)
    expect(await claimDiscoveryGapCheck(chainId, addresses[0])).toBe(false)
    expect(await client.ttl(gate(addresses[0]))).toBeGreaterThan(3590)
    await reserveDiscoveryRepair(chainId, addresses[1])
    expect(await claimDiscoveryGapCheck(chainId, addresses[1])).toBe(false)
  })
})
