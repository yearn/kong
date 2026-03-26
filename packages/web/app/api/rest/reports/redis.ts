export function getReportKey(
  chainId: number,
  address: string,
): string {
  return `rest:vault_reports:${chainId}:${address.toLowerCase()}`
}

export function getReportLatestKey(
  chainId: number,
  address: string,
): string {
  return `rest:vault_reports:latest:${chainId}:${address.toLowerCase()}`
}
