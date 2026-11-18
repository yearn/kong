import { z } from 'zod'
import type { Pool } from 'pg'
import { DAY_SECONDS, restHistoryStart } from '../history'
import { getTimeseriesSince } from './db'

// pg returns NUMERIC as text unless a process installed a custom type parser.
// Keep the cached representation intact rather than coercing API values.
const rowSchema = z.object({
  time: z.number().int(), component: z.string(), value: z.union([z.number(), z.string()]).nullable(),
})
const historicalSchema = z.object({
  value: rowSchema.array(),
  refreshedAt: z.number().int().nonnegative(),
  reconciledAt: z.number().int().nonnegative(),
})

// Replace the entire refreshed range, not just matching keys: a corrected bucket
// that is now all-null must disappear even though SQL no longer returns it.
function mergeHistorical(
  previous: z.infer<typeof rowSchema>[],
  recent: z.infer<typeof rowSchema>[],
  since: number,
  cutoff: number,
) {
  return [...previous.filter(row => row.time >= cutoff && row.time < since), ...recent]
    .sort((a, b) => a.time - b.time || a.component.localeCompare(b.component))
}

export async function refreshHistoricalSeries(
  chainId: number,
  address: string,
  label: string,
  cached: string | null,
  now: number,
  forceFull: boolean,
  pool: Pool,
) {
  let previous: z.infer<typeof historicalSchema> | undefined
  try {
    const parsed = historicalSchema.safeParse(JSON.parse(cached ?? 'null'))
    if (parsed.success) previous = parsed.data
  } catch { /* Old or corrupt entries are rebuilt from the database. */ }

  const cutoff = restHistoryStart(now)
  // Reuse a cache only while its timestamps support an incremental refresh.
  if (previous && (forceFull || previous.refreshedAt > now || previous.reconciledAt > now
    || now - previous.reconciledAt >= 7 * DAY_SECONDS)) {
    previous = undefined
  }
  // Include missed refresh days and re-read two complete UTC days for corrections.
  const since = previous
    ? Math.max(cutoff, (Math.floor(previous.refreshedAt / DAY_SECONDS) - 2) * DAY_SECONDS)
    : cutoff
  const rows = await getTimeseriesSince(chainId, address, label, since, pool)
  const recent = rows.map(row => ({ ...row, time: Number(row.time) }))
  const value = previous ? mergeHistorical(previous.value, recent, since, cutoff) : recent

  return {
    full: !previous,
    rowsRead: rows.length,
    payload: JSON.stringify({ value, refreshedAt: now, reconciledAt: previous?.reconciledAt ?? now }),
  }
}
