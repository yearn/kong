export function getTimeseriesKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `timeseries:${label}:${chainId}:${addressLower.toLowerCase()}`
}
