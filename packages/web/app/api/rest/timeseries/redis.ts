export function getTimeseriesKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `rest:timeseries:${label}:${chainId}:${addressLower.toLowerCase()}`
}

export function getTimeseriesLatestKey(
  label: string,
  chainId: number,
  addressLower: string,
): string {
  return `rest:timeseries:latest:${label}:${chainId}:${addressLower.toLowerCase()}`
}
