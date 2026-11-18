import { isAddress } from 'viem'
import db from '../../db'
import { mergeSnapshot, type SnapshotRow } from '../../../../lib/mergeSnapshot'
import { restHistoryStart } from '../history'

export type VaultSnapshot = SnapshotRow

// Ingest can carry older sparkline buckets forward into a recent snapshot.
// Both snapshot queries bind the REST cutoff to $1.
export const retainedSnapshotHook = `CASE
  WHEN jsonb_typeof(snapshot.hook->'sparklines') = 'object' THEN
    jsonb_set(snapshot.hook, '{sparklines}', COALESCE((
      SELECT jsonb_object_agg(key, jsonb_path_query_array(
        value, '$[*] ? (@.blockTime.double() >= $cutoff)',
        jsonb_build_object('cutoff', $1::double precision), true
      ))
      FROM jsonb_each(snapshot.hook->'sparklines')
    ), '{}'::jsonb))
  ELSE snapshot.hook END`

export async function getCurrentSnapshot(chainId: number, address: string): Promise<VaultSnapshot | undefined> {
  if (!Number.isSafeInteger(chainId) || !isAddress(address)) return undefined
  const { rows } = await db.query(`
    SELECT thing.address, thing.defaults, snapshot.snapshot, ${retainedSnapshotHook} AS hook
    FROM thing JOIN snapshot USING (chain_id, address)
    WHERE thing.label = 'vault' AND snapshot.block_time >= to_timestamp($1)
      AND thing.chain_id = $2 AND lower(thing.address) = $3
  `, [restHistoryStart(), chainId, address.toLowerCase()])
  const row = rows[0]
  if (!row) return undefined
  return { chainId, address: row.address, ...mergeSnapshot(row.defaults, row.snapshot, row.hook) }
}
