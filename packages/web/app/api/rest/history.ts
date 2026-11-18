export const DAY_SECONDS = 86_400

// Include today and the preceding 364 UTC dates.
export function restHistoryStart(now = Date.now() / 1000): number {
  return (Math.floor(now / DAY_SECONDS) - 364) * DAY_SECONDS
}

// Neither the browser nor the CDN should extend yesterday's retention window.
export function restCacheControl(requestedAt: number): string {
  const nextMidnight = (Math.floor(requestedAt / 1000 / DAY_SECONDS) + 1) * DAY_SECONDS
  const remaining = Math.max(0, nextMidnight - Math.ceil(Date.now() / 1000))
  const maxAge = Math.min(900, remaining)
  const stale = Math.min(600, remaining - maxAge)
  return `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${stale}`
}
