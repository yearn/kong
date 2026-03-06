export function getTimeseriesKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `rest:timeseries:${label}:${chainId}:${addressLower.toLowerCase()}`
}
