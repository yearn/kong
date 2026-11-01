export function boundedEnvInt(value: string | undefined, fallback: number, max: number, min = 0) {
  if (value === undefined || !/^\d+$/.test(value)) return fallback
  return Math.min(Math.max(Number(value), min), max)
}
