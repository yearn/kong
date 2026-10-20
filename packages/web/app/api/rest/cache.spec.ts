import { strict as assert } from 'node:assert'
import { cacheMGet, cacheMSet, estimateMSetRequestSize, getKeyvClient, lastRefreshHeaders, setLastRefresh, splitPairsForMSet, writeClient } from './cache'

describe('cacheMGet', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads more than 10 MiB in individual commands with bounded concurrency and preserves key order and misses', async () => {
    vi.spyOn(writeClient, 'connect').mockResolvedValue(writeClient as never)
    const mGet = vi.spyOn(writeClient, 'mGet').mockRejectedValue(new Error('oversized MGET'))
    const keys = Array.from({ length: 13 }, (_, index) => `history:${index}`)
    const payload = 'x'.repeat(1024 * 1024)
    let active = 0
    let peak = 0
    vi.spyOn(writeClient, 'get').mockImplementation(async (...args) => {
      const key = args.length === 1 ? args[0] : args[1]
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return key === keys[6] ? null : `${key}:${payload}`
    })

    const values = await cacheMGet(keys)

    assert.deepEqual(values, keys.map(key => key === keys[6] ? null : `${key}:${payload}`))
    assert.ok(values.reduce((size, value) => size + Buffer.byteLength(value ?? ''), 0) > 10 * 1024 * 1024)
    assert.equal(peak, 5)
    assert.equal(active, 0)
    assert.equal(mGet.mock.calls.length, 0)
  })

  it('returns an empty result without connecting for no keys', async () => {
    const connect = vi.spyOn(writeClient, 'connect')
    const get = vi.spyOn(writeClient, 'get')

    assert.deepEqual(await cacheMGet([]), [])
    assert.equal(connect.mock.calls.length, 0)
    assert.equal(get.mock.calls.length, 0)
  })

  it('settles the current batch and stops scheduling reads after a failure', async () => {
    vi.spyOn(writeClient, 'connect').mockResolvedValue(writeClient as never)
    const failure = new Error('Redis read failed')
    let completed = 0
    const get = vi.spyOn(writeClient, 'get').mockImplementation(async (...args) => {
      const key = args.length === 1 ? args[0] : args[1]
      if (key === 'bad') throw failure
      await Promise.resolve()
      completed++
      return 'cached'
    })

    await assert.rejects(cacheMGet(['bad', 'a', 'b', 'c', 'd', 'unscheduled']), failure)

    assert.equal(completed, 4)
    assert.equal(get.mock.calls.length, 5)
  })
})

describe('splitPairsForMSet', () => {
  it('keeps all pairs in one chunk when below the target', () => {
    const pairs: Array<[string, string]> = [
      ['alpha', '1'],
      ['beta', '2'],
    ]

    const chunks = splitPairsForMSet(pairs, estimateMSetRequestSize(pairs) + 1)

    assert.deepEqual(chunks, [pairs])
  })

  it('splits pairs into ordered chunks below the target', () => {
    const pairs: Array<[string, string]> = [
      ['alpha', 'x'.repeat(32)],
      ['beta', 'y'.repeat(32)],
      ['gamma', 'z'.repeat(32)],
    ]

    const singlePairSize = estimateMSetRequestSize([pairs[0]])
    const targetBytes = singlePairSize + 10
    const chunks = splitPairsForMSet(pairs, targetBytes)

    assert.deepEqual(chunks, [
      [pairs[0]],
      [pairs[1]],
      [pairs[2]],
    ])
  })

  it('throws when a single pair exceeds the Redis hard limit', () => {
    const tooLarge: Array<[string, string]> = [
      ['huge', 'x'.repeat((10 * 1024 * 1024) + 1)],
    ]

    assert.throws(() => splitPairsForMSet(tooLarge), /exceeds hard limit/)
  })
})

describe('rest cache write client', () => {
  it('logs redis errors instead of crashing the process', () => {
    assert.equal(writeClient.listenerCount('error'), 1)
  })
})

describe('atomic cache publication', () => {
  afterEach(() => vi.restoreAllMocks())

  it('publishes both views in one command even above the chunk target', async () => {
    vi.spyOn(writeClient, 'connect').mockResolvedValue(writeClient as never)
    const mSet = vi.spyOn(writeClient, 'mSet').mockResolvedValue('OK')
    const pairs: Array<[string, string]> = [
      ['diagnostics', 'x'.repeat(8 * 1024 * 1024)],
      ['summary', '{"chains":[]}'],
    ]

    await cacheMSet(pairs, { atomic: true })

    assert.deepEqual(mSet.mock.calls, [[pairs]])
  })

  it('rejects an oversized combined publication before connecting or writing', async () => {
    const connect = vi.spyOn(writeClient, 'connect')
    const mSet = vi.spyOn(writeClient, 'mSet')
    const pairs: Array<[string, string]> = [
      ['diagnostics', 'x'.repeat(6 * 1024 * 1024)],
      ['summary', 'x'.repeat(5 * 1024 * 1024)],
    ]

    await assert.rejects(cacheMSet(pairs, { atomic: true }), /exceeds hard limit/)

    assert.equal(connect.mock.calls.length, 0)
    assert.equal(mSet.mock.calls.length, 0)
  })
})

describe('last refresh', () => {
  const keyv = getKeyvClient()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setLastRefresh stores an ISO timestamp under rest:refresh:<job>', async () => {
    const set = vi.spyOn(keyv, 'set').mockResolvedValue(undefined as never)
    const at = new Date('2026-01-02T03:04:05.000Z')

    await setLastRefresh('refresh-cache', at)

    assert.deepEqual(set.mock.calls, [['rest:refresh:refresh-cache', '2026-01-02T03:04:05.000Z']])
  })

  it('setLastRefresh defaults to the current time', async () => {
    const set = vi.spyOn(keyv, 'set').mockResolvedValue(undefined as never)

    await setLastRefresh('reports-refresh')

    assert.equal(set.mock.calls[0][0], 'rest:refresh:reports-refresh')
    assert.match(set.mock.calls[0][1] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('lastRefreshHeaders returns the header and expose list when a timestamp exists', async () => {
    vi.spyOn(keyv, 'get').mockResolvedValue('2026-01-02T03:04:05.000Z')

    assert.deepEqual(await lastRefreshHeaders('refresh-cache'), {
      'x-last-refresh': '2026-01-02T03:04:05.000Z',
      'access-control-expose-headers': 'x-last-refresh',
    })
  })

  it('lastRefreshHeaders returns no headers when the key is missing', async () => {
    const get = vi.spyOn(keyv, 'get').mockResolvedValue(undefined)

    assert.deepEqual(await lastRefreshHeaders('refresh-cache'), {})
    assert.deepEqual(get.mock.calls, [['rest:refresh:refresh-cache']])
  })

  it('lastRefreshHeaders returns no headers when redis throws', async () => {
    vi.spyOn(keyv, 'get').mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    assert.deepEqual(await lastRefreshHeaders('refresh-cache'), {})
  })
})
