import { first } from '../../ingest/db'
import { Snapshot, SnapshotSchema, Thing, ThingSchema, VaultThingsWithName, VaultThingsWithNameSchema } from '../types'

export async function getThingSnapshot(chainId: number, address: `0x${string}`) {
  return first<Snapshot>(SnapshotSchema, `
    SELECT *
    FROM snapshot
    WHERE chain_id = $1 AND address = $2
  `, [chainId, address])
}

export async function getThingWithName(chainId: number, address: `0x${string}`, type: 'vault' | 'strategy' = 'vault') {
  return first<VaultThingsWithName>(VaultThingsWithNameSchema,
    `select thing.*, snapshot.snapshot->>'name' as name
      from thing
      join snapshot on thing.chain_id = snapshot.chain_id and thing.address = snapshot.address
      where thing.chain_id = $1 AND thing.address = $2 AND thing.label = $3 AND (thing.defaults->>'yearn')::boolean = true`,
    [chainId, address, type]
  )
}

export async function getThing(chainId: number, address: `0x${string}`, label: string) {
  return first<Thing>(ThingSchema,
    `select *
      from thing
      where chain_id = $1 AND address = $2 AND label = $3`,
    [chainId, address, label]
  )
}
