import { createKeyv } from '@keyv/redis'
import { getTimeseriesKey, getTimeseriesLatestKey } from '../../redis'
import { PpsBatchRequest, PpsBatchResponse, PpsPoint } from './contract'

type CacheGet = (keys: string[]) => Promise<unknown>

type PpsCandidate = {
  time: number
  value: unknown
}

const timeseriesKeyv = createKeyv(
  process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379',
  { throwOnErrors: true },
)
const NUMERIC_STRING_PATTERN = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/
const MAX_VALUE_LENGTH = 128
const CACHE_BATCH_SERIES = 8

function getCachedRows(value: unknown, key: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`Invalid cached timeseries value for ${key}`)
  return value
}

function toPpsPoint(candidate: PpsCandidate): PpsPoint {
  if (candidate.time % 86_400 !== 0) {
    throw new Error('Invalid cached PPS timestamp')
  }

  if (typeof candidate.value === 'number') {
    if (!Number.isFinite(candidate.value)) throw new Error('Invalid cached PPS value')
    return { time: candidate.time, value: String(candidate.value) }
  }

  if (
    typeof candidate.value !== 'string' ||
    candidate.value.length === 0 ||
    candidate.value.length > MAX_VALUE_LENGTH ||
    !NUMERIC_STRING_PATTERN.test(candidate.value)
  ) {
    throw new Error('Invalid cached PPS value')
  }

  return { time: candidate.time, value: candidate.value }
}

function toPpsCandidate(value: unknown): PpsCandidate | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid cached timeseries row')
  }

  const row = value as Record<string, unknown>
  if (typeof row.component !== 'string') {
    throw new Error('Invalid cached timeseries row')
  }
  if (row.component !== 'humanized') return undefined

  if (typeof row.time !== 'number' || !Number.isSafeInteger(row.time) || row.time < 0) {
    throw new Error('Invalid cached PPS timestamp')
  }

  return { time: row.time, value: row.value }
}

export function mergeAndSlicePps(
  historical: unknown[],
  latest: unknown[],
  start: number,
  finish: number,
): PpsPoint[] {
  let anchor: PpsCandidate | undefined
  const pointsByTime = new Map<number, PpsCandidate>()

  function apply(rows: unknown[]) {
    for (const value of rows) {
      const candidate = toPpsCandidate(value)
      if (!candidate) continue

      if (candidate.time <= start) {
        if (!anchor || candidate.time >= anchor.time) anchor = candidate
      } else if (candidate.time <= finish) {
        pointsByTime.set(candidate.time, candidate)
      }
    }
  }

  apply(historical)
  apply(latest)

  return [
    ...(anchor ? [toPpsPoint(anchor)] : []),
    ...Array.from(pointsByTime.values())
      .sort((a, b) => a.time - b.time)
      .map(toPpsPoint),
  ]
}

export async function readPpsBatch(
  request: PpsBatchRequest,
  cacheGet: CacheGet = (keys) => timeseriesKeyv.get(keys),
): Promise<PpsBatchResponse> {
  const entries: Array<readonly [string, PpsPoint[]]> = []

  for (let offset = 0; offset < request.addresses.length; offset += CACHE_BATCH_SERIES) {
    const addresses = request.addresses.slice(offset, offset + CACHE_BATCH_SERIES)
    const keys = addresses.flatMap(({ chainId, address }) => [
      getTimeseriesKey('pps', chainId, address),
      getTimeseriesLatestKey('pps', chainId, address),
    ])
    const cached = await cacheGet(keys)
    const values = cached === undefined ? Array(keys.length).fill(undefined) : cached

    if (!Array.isArray(values) || values.length !== keys.length) {
      throw new Error('Invalid PPS cache batch response')
    }

    addresses.forEach(({ key }, index) => {
      const historicalIndex = index * 2
      const latestIndex = historicalIndex + 1
      const points = mergeAndSlicePps(
        getCachedRows(values[historicalIndex], keys[historicalIndex]),
        getCachedRows(values[latestIndex], keys[latestIndex]),
        request.start,
        request.finish,
      )

      entries.push([key, points])
    })
  }

  return Object.fromEntries(entries)
}
