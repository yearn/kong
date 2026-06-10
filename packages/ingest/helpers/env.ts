export function parsePositiveIntDays(envName: string, fallback: number): number {
  const value = process.env[envName]
  if (value === undefined) return fallback
  const days = Number(value)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`${envName} must be a positive integer, got ${value}`)
  }
  return days
}
