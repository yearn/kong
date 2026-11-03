import db from '../db'

function toAssets(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined
  try { return BigInt(value as string | number | bigint) } catch { return undefined }
}

/**
 * Pick the snapshot tvl from the tvl sparkline. When the newest point reads 0 while the
 * vault still holds assets (e.g. a missing price at the UTC rollover), fall back to the
 * latest non-zero tvl-c value instead of publishing $0. Genuinely empty vaults, or vaults
 * whose assets are unknown, keep the newest point.
 */
export async function resolveSnapshotTvl<T extends { close: number }>(
  chainId: number, address: string, sparkline: T[], totalAssets: unknown
): Promise<T | undefined> {
  const newest = sparkline[0]
  if (!newest || newest.close > 0) return newest
  const assets = toAssets(totalAssets)
  if (assets === undefined || assets === 0n) return newest
  const result = await db.query(
    `SELECT value FROM output
     WHERE chain_id = $1 AND address = $2 AND label = 'tvl-c' AND component = 'tvl' AND value > 0
     ORDER BY series_time DESC LIMIT 1`,
    [chainId, address]
  )
  const value = Number(result.rows[0]?.value)
  return Number.isFinite(value) && value > 0 ? { ...newest, close: value } : newest
}
