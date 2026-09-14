import { strict as assert } from 'node:assert'
import { estimateMSetRequestSize, getKeyvClient, lastRefreshHeaders, setLastRefresh, splitPairsForMSet, writeClient } from './cache'

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
