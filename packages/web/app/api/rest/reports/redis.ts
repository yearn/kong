export function getReportKey(
  chainId: number,
  address: string,
): string {
  return `vault_reports:${chainId}:${address.toLowerCase()}`
}
