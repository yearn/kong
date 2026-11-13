/** Run every item with a fixed upper bound and wait for all in-flight work. */
export async function mapSettledLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  for (let offset = 0; offset < items.length; offset += limit) {
    const batch = items.slice(offset, offset + limit)
    results.push(...await Promise.allSettled(
      batch.map((item, index) => task(item, offset + index)),
    ))
  }
  return results
}

export function throwSettledFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length === 1) throw failures[0].reason
  if (failures.length > 1) {
    throw new AggregateError(failures.map(({ reason }) => reason), `${failures.length} job operations failed`)
  }
}
