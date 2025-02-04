export function DEFAULT_START_MS() {
  return daysAgoMs(Number(process.env.DEFAULT_START_DAYS_AGO || 30))
} 

export function DEFAULT_START() {
  return BigInt(Math.floor(DEFAULT_START_MS() / 1000))
}

export function daysAgoMs(days: number): number {
  const now = new Date().getTime()
  return now - days * 24 * 60 * 60 * 1000
}

export function startOfDayMs(milliseconds: number): number {
  const date = new Date(milliseconds)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function endOfDayMs(milliseconds: number): number {
  const date = new Date(milliseconds)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

export function endOfDay(blocktime: bigint): bigint {
  return BigInt(Math.floor(endOfDayMs(Number(blocktime) * 1000) / 1000))
}

export function epoch(date: string) {
  return BigInt((new Date(date)).getTime() / 1000)
}

export function endOfStringDay(date: string) {
  return endOfDay(epoch(date))
}

export function makeTimeline(start: bigint, end: bigint): bigint[] {
  start = endOfDay(start)
  end = endOfDay(end)

  let current = start
  const result: bigint[] = []

  while (current <= end) {
    result.push(current)
    current = endOfDay(BigInt(current + 1n))
  }

  return result
}

export function findMissingTimestamps(start: bigint, end: bigint, outputed: bigint[]): bigint[] {
  const result: bigint[] = []
  const timeline = makeTimeline(start, end)

  outputed.forEach((time, index) => outputed[index] = endOfDay(time))

  for (const time of timeline) {
    const index = outputed.indexOf(time)
    if (index === -1) result.push(time)
  }

  return result
}
