export function getReportKey(
  chainId: number,
  address: string,
): string {
  return `rest:vault_reports:${chainId}:${address.toLowerCase()}`
}
