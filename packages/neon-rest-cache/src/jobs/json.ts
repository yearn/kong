/** Match lib/global's BigInt JSON contract without mutating BigInt.prototype. */
export function stringifyCacheValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (
    typeof item === 'bigint' ? item.toString() : item
  ))
}
