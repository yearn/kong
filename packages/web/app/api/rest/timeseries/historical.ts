import { z } from 'zod'
import type { Pool } from 'pg'
import { getFullTimeseries, getTimeseriesSince } from './db'

const DAY = 86400
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
export function mergeHistorical(
  previous: z.infer<typeof rowSchema>[],
  recent: z.infer<typeof rowSchema>[],
  since: number,
) {
  return [...previous.filter(row => row.time < since), ...recent]
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

  const full = forceFull || !previous || previous.refreshedAt > now
    || previous.reconciledAt > now || now - previous.reconciledAt >= 7 * DAY
  // Include missed refresh days and re-read two complete UTC days for corrections.
  const since = Math.floor(Math.min(previous?.refreshedAt ?? now, now) / DAY) * DAY - 2 * DAY
  const rows = full
    ? await getFullTimeseries(chainId, address, label, pool)
    : await getTimeseriesSince(chainId, address, label, since, pool)
  const recent = rows.map(row => ({ ...row, time: Number(row.time) }))
  const value = full ? recent : mergeHistorical(previous!.value, recent, since)

  return {
    full,
    rowsRead: rows.length,
    payload: JSON.stringify({ value, refreshedAt: now, reconciledAt: full ? now : previous!.reconciledAt }),
  }
}
