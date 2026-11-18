import { estimateHeight, estimateHeightAtOrBefore, getBlock } from 'lib/blocks'
import { endOfDay } from 'lib/dates'

type SeriesObservation = {
  blockTime: bigint
  seriesTime?: bigint
  isClosedDay?: boolean
}

/** Resolve a completed series day to its last eligible block; use the live head for today's open series. */
export async function resolveTimeseriesBlock(chainId: number, data: SeriesObservation): Promise<bigint | undefined> {
  const isDailySeriesDay = endOfDay(data.blockTime) === data.blockTime &&
    (data.seriesTime === undefined || data.seriesTime === data.blockTime)

  if (data.isClosedDay !== undefined && isDailySeriesDay) {
    if (!data.isClosedDay) return (await getBlock(chainId)).number
    return await estimateHeightAtOrBefore(chainId, data.seriesTime ?? data.blockTime)
  }

  // Direct callers and old backfill jobs keep the original interpretation of
  // blockTime. seriesTime is storage metadata unless extractor marked an
  // eligible daily-grid request.
  if (data.blockTime >= BigInt(Math.floor(Date.now() / 1000))) return (await getBlock(chainId)).number
  return await estimateHeight(chainId, data.blockTime)
}
