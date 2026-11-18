import { beforeEach, expect, it, vi } from 'vitest'

const { query, next, store, redisGet, redisSet } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const redisGet = vi.fn(async (key: string) => store.get(key) ?? null)
  const redisSet = vi.fn(async (key: string, value: string) => { store.set(key, value) })
  return { query: vi.fn(), next: vi.fn(), store, redisGet, redisSet }
})

vi.mock('./db', () => ({ default: { query } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
vi.mock('lib/cache', async () => {
  const { caching } = await import('cache-manager')
  const { redisInsStore } = await import('cache-manager-redis-yet')
  const client = { get: redisGet, set: redisSet, on() {} }
  return { cache: await caching(redisInsStore(client as never)) }
})

import { fetchAssetAddress, fetchDecimals, fetchOrExtractAssetAddress, fetchOrExtractDecimals } from './abis/yearn/lib'

const VAULT = '0x0000000000000000000000000000000000000001' as const
const ASSET = '0x0000000000000000000000000000000000000002' as const

beforeEach(() => {
  query.mockReset()
  next.mockReset()
  redisGet.mockClear()
  redisSet.mockClear()
  store.clear()
})

it.each([0, '0'])('uses stored zero decimals (%s) without RPC', async decimals => {
  query.mockResolvedValue({ rows: [{ decimals }] })
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(decimals)
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(decimals)
  expect(next).not.toHaveBeenCalled()
  expect(query).toHaveBeenCalledTimes(1)
})

it('reuses successful DB decimals with a finite TTL', async () => {
  query.mockResolvedValue({ rows: [{ decimals: '18' }] })
  expect(await fetchDecimals(1, '0x00000000000000000000000000000000000000Ab')).toBe('18')
  expect(await fetchDecimals(1, '0x00000000000000000000000000000000000000ab')).toBe('18')
  expect(query).toHaveBeenCalledTimes(1)
  expect(redisSet).toHaveBeenCalledWith('fetchDecimals:1:0x00000000000000000000000000000000000000ab', '"18"', { PX: 60 * 60 * 1000 })
})

it.each([0n, 6n])('caches successful direct chain decimals, including zero (%s)', async chainDecimals => {
  query.mockResolvedValue({ rows: [] })
  const readContract = vi.fn().mockResolvedValue(chainDecimals)
  next.mockReturnValue({ readContract })

  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(Number(chainDecimals))
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(Number(chainDecimals))
  expect(readContract).toHaveBeenCalledTimes(1)
  expect(query).toHaveBeenCalledTimes(2)
  expect(redisSet).toHaveBeenCalledWith(`chainDecimals:1:${VAULT}`, String(chainDecimals), { PX: 60 * 60 * 1000 })
})

it('caches underlying token decimals when the vault has no decimals method', async () => {
  query.mockResolvedValue({ rows: [] })
  const readContract = vi.fn().mockRejectedValueOnce(new Error('no decimals method')).mockResolvedValue(18n)
  const multicall = vi.fn().mockResolvedValue([{ result: ASSET }, { result: undefined }])
  next.mockReturnValue({ readContract, multicall })

  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(18)
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(18)
  expect(readContract).toHaveBeenCalledTimes(2)
  expect(multicall).toHaveBeenCalledTimes(1)
})

it('does not cache DB misses and lets a later DB correction beat the cached chain fallback', async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ decimals: 18 }] })
  const readContract = vi.fn().mockResolvedValue(6n)
  next.mockReturnValue({ readContract })

  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(6)
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(18)
  expect(await fetchOrExtractDecimals(1, VAULT)).toBe(18)
  expect(query).toHaveBeenCalledTimes(2)
  expect(readContract).toHaveBeenCalledTimes(1)
})

it('retries chain fallback after an error instead of caching the failure', async () => {
  query.mockResolvedValue({ rows: [] })
  const readContract = vi.fn().mockRejectedValue(new Error('no decimals method'))
  const multicall = vi.fn().mockResolvedValue([{ result: undefined }, { result: undefined }])
  next.mockReturnValue({ readContract, multicall })

  await expect(fetchOrExtractDecimals(1, VAULT)).rejects.toThrow(`!asset ${VAULT}`)
  await expect(fetchOrExtractDecimals(1, VAULT)).rejects.toThrow(`!asset ${VAULT}`)
  expect(readContract).toHaveBeenCalledTimes(2)
  expect(multicall).toHaveBeenCalledTimes(2)
  expect(store.size).toBe(0)
})

it('reads scalar and legacy nested asset metadata without changing address, label, or fallback semantics', async () => {
  query.mockResolvedValue({ rows: [{ address: ASSET }] })

  expect(await fetchAssetAddress(1, VAULT, 'vault')).toBe(ASSET)
  expect(await fetchOrExtractAssetAddress(1, VAULT, 'vault', 'asset')).toBe(ASSET)
  const [sql, params] = query.mock.calls[0]
  expect(sql).toContain('defaults #>> \'{asset, address}\'')
  expect(sql).toContain('jsonb_typeof(defaults->\'asset\') = \'string\'')
  expect(sql).toContain('defaults #>> \'{asset}\'')
  expect(params).toEqual([1, VAULT, 'vault'])
  expect(next).not.toHaveBeenCalled()
})
