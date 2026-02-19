export function getSnapshotKey(
  chainId: number,
  address: string,
): string {
  return `snapshot:${chainId}:${address.toLowerCase()}`
}
