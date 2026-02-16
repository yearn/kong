export function getTimeseriesKey(
  chainId: number,
  addressLower: string,
): string {
  return `timeseries:${chainId}:${addressLower.toLowerCase()}`
}
