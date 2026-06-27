// Guards that bound the database work an anonymous public-GraphQL caller can request.
// See FINDINGS.md findings 1-3 (CWE-400, unbounded query/aggregation).

export const MAX_GQL_LIMIT = 1000
const DEFAULT_GQL_LIMIT = 100

// Coarse buckets only. `output` is sampled at >= 1 day, so finer periods just
// multiply time_bucket work; an allowlist also blocks arbitrary interval strings.
const ALLOWED_PERIODS = new Set(['1 hour', '1 day', '1 week', '1 month', '1 year'])
const DEFAULT_PERIOD = '1 day'

export function clampLimit(limit?: number | null): number {
  if (limit == null) return DEFAULT_GQL_LIMIT
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`invalid limit: ${limit}`)
  return Math.min(limit, MAX_GQL_LIMIT)
}

export function resolvePeriod(period?: string | null): string {
  if (period == null) return DEFAULT_PERIOD
  if (!ALLOWED_PERIODS.has(period)) throw new Error(`invalid period: ${period}`)
  return period
}
