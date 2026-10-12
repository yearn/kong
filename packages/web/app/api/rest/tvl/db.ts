import type { Pool } from 'pg'
import { mergeSnapshot } from '../../../../lib/mergeSnapshot'
import { buildVaultFilters } from '../../../../lib/vaultFilters'
import { cronDb } from '../../db/cron'
import type { AggregateTvlSnapshot, AggregateTvlStrategyRef } from './aggregate'

type SnapshotDbRow = {
  chainId: number | string
  address: string
  _defaults: Record<string, unknown> | null
  _snapshot: Record<string, unknown> | null
  _hook: Record<string, unknown> | null
}

function toAggregateSnapshot(row: SnapshotDbRow): AggregateTvlSnapshot {
  return {
    chainId: Number(row.chainId),
    address: row.address,
    hook: row._hook,
    mergedSnapshot: mergeSnapshot(row._defaults, row._snapshot, row._hook),
  }
}

/** Read Yearn vault rows and their snapshots in one query. */
export async function getAggregateVaults(pool: Pool = cronDb): Promise<AggregateTvlSnapshot[]> {
  const { where, params } = buildVaultFilters({ yearn: true })
  const result = await pool.query<SnapshotDbRow>(`
    WITH latest_snapshot AS (
      SELECT DISTINCT ON (chain_id, lower(address))
        chain_id,
        lower(address) AS normalized_address,
        snapshot,
        hook
      FROM snapshot
      WHERE EXISTS (
        SELECT 1
        FROM thing AS vault_thing
        WHERE vault_thing.chain_id = snapshot.chain_id
          AND lower(vault_thing.address) = lower(snapshot.address)
          AND vault_thing.label = 'vault'
      )
      ORDER BY chain_id, lower(address), block_number DESC NULLS LAST, address
    )
    SELECT DISTINCT ON (thing.chain_id, lower(thing.address))
      thing.chain_id AS "chainId",
      thing.address,
      thing.defaults AS _defaults,
      snapshot.snapshot AS _snapshot,
      snapshot.hook AS _hook
    FROM thing
    LEFT JOIN latest_snapshot AS snapshot
      ON thing.chain_id = snapshot.chain_id
      AND lower(thing.address) = snapshot.normalized_address
    WHERE ${where}
    ORDER BY thing.chain_id, lower(thing.address), thing.address
  `, params)

  return result.rows.map(toAggregateSnapshot)
}

/**
 * Batch-read only strategy snapshots referenced by the selected vaults.
 * These snapshots are used solely when they publish explicit attributable
 * aggregateTvlExposures in their hook.
 */
export async function getAggregateStrategies(
  refs: AggregateTvlStrategyRef[],
  pool: Pool = cronDb,
): Promise<AggregateTvlSnapshot[]> {
  const unique = new Map<string, AggregateTvlStrategyRef>()
  for (const ref of refs) {
    if (!Number.isInteger(ref.chainId) || ref.chainId <= 0) continue
    const address = typeof ref.address === 'string' ? ref.address.trim().toLowerCase() : ''
    if (!address) continue
    unique.set(`${ref.chainId}:${address}`, { chainId: ref.chainId, address })
  }

  const strategies = [...unique.values()]
  if (strategies.length === 0) return []

  const result = await pool.query<SnapshotDbRow>(`
    WITH requested AS (
      SELECT chain_id, lower(address) AS address
      FROM unnest($1::int[], $2::text[]) AS refs(chain_id, address)
    ), latest_snapshot AS (
      SELECT DISTINCT ON (chain_id, lower(address))
        chain_id,
        lower(address) AS normalized_address,
        snapshot,
        hook
      FROM snapshot
      WHERE EXISTS (
        SELECT 1
        FROM requested
        WHERE requested.chain_id = snapshot.chain_id
          AND requested.address = lower(snapshot.address)
      )
      ORDER BY chain_id, lower(address), block_number DESC NULLS LAST, address
    )
    SELECT DISTINCT ON (thing.chain_id, lower(thing.address))
      thing.chain_id AS "chainId",
      thing.address,
      thing.defaults AS _defaults,
      snapshot.snapshot AS _snapshot,
      snapshot.hook AS _hook
    FROM thing
    INNER JOIN requested
      ON requested.chain_id = thing.chain_id
      AND requested.address = lower(thing.address)
    LEFT JOIN latest_snapshot AS snapshot
      ON thing.chain_id = snapshot.chain_id
      AND lower(thing.address) = snapshot.normalized_address
    WHERE thing.label = 'strategy'
    ORDER BY thing.chain_id, lower(thing.address), thing.address
  `, [strategies.map(ref => ref.chainId), strategies.map(ref => ref.address)])

  return result.rows.map(toAggregateSnapshot)
}
