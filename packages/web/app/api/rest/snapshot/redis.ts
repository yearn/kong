export function getSnapshotKey(
  chainId: number,
  address: string,
): string {
  return `rest:snapshot:${chainId}:${address.toLowerCase()}`
}
