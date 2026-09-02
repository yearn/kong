type Blob = Record<string, unknown> | null | undefined

export type SnapshotRow = {
  chainId: number
  address: string
  [key: string]: unknown
}

// Merge a thing's blobs into the shape the API serves. Contract state must not
// be shadowed by hook keys — hooks that stop running for a thing (e.g. the
// erc4626 hook after a vault turns yearn: true) leave stale keys behind in the
// hook blob, since upsertSnapshot merges hooks shallowly. `asset` is the one
// exception: hooks enrich it into an erc20 object that must win over the raw
// asset() address in contract state.
export function mergeSnapshot(defaults: Blob, snapshot: Blob, hook: Blob): Record<string, unknown> {
  return {
    ...(defaults ?? {}),
    ...(hook ?? {}),
    ...(snapshot ?? {}),
    ...(hook?.asset != null ? { asset: hook.asset } : {}),
  }
}

export const VAULT_UNSERVED_KEYS = [
  'composition', 'allocators', 'blockNumber', 'blockTime', 'factory', 'keeper',
  'pendingManagement', 'performanceFeeRecipient', 'roleManager', 'vaults', 'MAX_FEE', 'MIN_FEE'
]

const MERGED_BLOBS =
  '(COALESCE(thing.defaults, \'{}\') || COALESCE(snapshot.hook, \'{}\') || COALESCE(snapshot.snapshot, \'{}\'))'

export const mergedFieldSql = (key: string) => `(${MERGED_BLOBS}->>'${key}')`

export const mergeSnapshotSql = (omit: string[] = []) =>
  `(${MERGED_BLOBS}
    || COALESCE(jsonb_strip_nulls(jsonb_build_object('asset', snapshot.hook->'asset')), '{}'))
    - ARRAY[${omit.map(k => `'${k}'`).join(', ')}]::text[]`
