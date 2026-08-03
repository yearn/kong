export type Shard = { index: number; total: number }

/**
 * Split a work list deterministically so a job too large for one serverless
 * invocation can spread across consecutive cron ticks. Assignment is by content
 * hash, not list position, so a vault keeps its shard as the list grows.
 */
export function selectShard<T>(items: T[], key: (item: T) => string, shard?: Shard): T[] {
  if (!shard || shard.total <= 1) return items
  return items.filter((item) => fnv1a(key(item)) % shard.total === shard.index)
}

function fnv1a(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
