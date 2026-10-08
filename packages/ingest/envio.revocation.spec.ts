import { describe, expect, it, vi } from 'vitest'
import { cache } from 'lib/cache'
import { Queue } from 'bullmq'
import { invalidateEnvioSource, isEnvioSourceTrusted } from './envio'

describe('Redis-backed Envio coverage revocation', () => {
  it('persists without expiry across cache reconnect and requires explicit reconfirmation', async () => {
    const source = { chainId: 31337, address: '0x0000000000000000000000000000000000000002' as `0x${string}`, abiPath: 'yearn/3/vault', fromBlock: '1', confirmationId: 'revocation-spec' }
    const pattern = `envioSourceInvalid:31337:${source.address}:${source.abiPath}:*`
    const queue = new Queue('envio-revocation-spec', { connection: { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) } })
    const client = await queue.client
    vi.stubEnv('USE_ENVIO', 'true'); vi.stubEnv('ENVIO_CHAINS', '31337')
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([source]))
    try {
      for (const key of await cache.keys(pattern)) await cache.del(key)
      expect(await isEnvioSourceTrusted(31337, source.address, source.abiPath, 1n)).toBe(true)
      await invalidateEnvioSource(31337, source.address, source.abiPath)
      const keys = await cache.keys(pattern)
      expect(keys).toHaveLength(1)
      expect(await client.pttl(keys[0])).toBe(-1)
      await cache.down(); await cache.up()
      expect(await isEnvioSourceTrusted(31337, source.address, source.abiPath, 2n)).toBe(false)
      vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ ...source, confirmationId: 'reconfirmed-spec' }]))
      expect(await isEnvioSourceTrusted(31337, source.address, source.abiPath, 2n)).toBe(true)
    } finally {
      for (const key of await cache.keys(pattern)) await cache.del(key)
      await queue.close()
      vi.unstubAllEnvs()
    }
  })
})
