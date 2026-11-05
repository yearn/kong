const MAX_AGE_SECONDS = 14 * 24 * 60 * 60

/**
 * Current snapshot tvl is the newest tvl sparkline bucket, and only while that bucket is
 * recent. The weekly bucket keeps its own observation date; an older bucket is last-known
 * history (still served in sparklines), never a current valuation. Never looks further
 * back: a missing current price stays missing instead of inheriting an old balance's value.
 * Returns null, not undefined: the hook travels through the queue as JSON, and an absent
 * key would leave the previous snapshot's tvl in place on merge.
 */
export function resolveSnapshotTvl<T extends { blockTime: bigint }>(
  sparkline: T[], nowSeconds = Math.floor(Date.now() / 1000)
): T | null {
  const newest = sparkline[0]
  if (!newest || Number(newest.blockTime) < nowSeconds - MAX_AGE_SECONDS) return null
  return newest
}
