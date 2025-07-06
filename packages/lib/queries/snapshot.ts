import { Snapshot, SnapshotSchema } from '../types'
import { first } from '../../ingest/db'

export async function getSnapshot(chainId: number, address: `0x${string}`) {
  return first<Snapshot>(SnapshotSchema, `
    SELECT *
    FROM snapshot
    WHERE chain_id = $1 AND address = $2
  `, [chainId, address])
}
