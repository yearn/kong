import type { Pool } from 'pg'
import { EvmAddressSchema } from 'lib/types'
import { mergeSnapshot } from '../../../../lib/mergeSnapshot'
import { buildVaultFilters } from '../../../../lib/vaultFilters'
import { cronDb } from '../../db/cron'
import type { AggregateTvlSnapshot, AggregateTvlStrategyRef, AggregateTvlStrategySnapshot } from './aggregate'

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

function selectVaultSnapshots(where: string): string {
  return `
    SELECT
      thing.chain_id AS "chainId",
      thing.address,
      thing.defaults AS _defaults,
      snapshot.snapshot AS _snapshot,
      snapshot.hook AS _hook
    FROM thing
    LEFT JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE ${where}
  `
}

/** Read Yearn vault rows and their snapshots in one query. */
export async function getAggregateVaults(pool: Pool = cronDb): Promise<AggregateTvlSnapshot[]> {
  const { where, params } = buildVaultFilters({ yearn: true })
  const result = await pool.query<SnapshotDbRow>(selectVaultSnapshots(where), params)
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
): Promise<AggregateTvlStrategySnapshot[]> {
  const unique = new Map<string, AggregateTvlStrategyRef>()
  for (const ref of refs) {
    if (!Number.isInteger(ref.chainId) || ref.chainId <= 0) continue
    // Calculator identities are lowercase; ingestion stores checksummed addresses.
    const parsed = EvmAddressSchema.safeParse(
      typeof ref.address === 'string' ? ref.address.trim().toLowerCase() : '',
    )
    if (!parsed.success) continue
    const address = parsed.data
    unique.set(`${ref.chainId}:${address}`, { chainId: ref.chainId, address })
  }

  const strategies = Array.from(unique.values())
  if (strategies.length === 0) return []

  const result = await pool.query<AggregateTvlStrategySnapshot>(`
    SELECT thing.chain_id AS "chainId", thing.address,
      jsonb_build_object('aggregateTvlExposures', snapshot.hook->'aggregateTvlExposures') AS hook
    FROM unnest($1::int[], $2::text[]) AS requested(chain_id, address)
    INNER JOIN thing
      ON requested.chain_id = thing.chain_id
      AND requested.address = thing.address
      AND thing.label = 'strategy'
    INNER JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE jsonb_typeof(snapshot.hook->'aggregateTvlExposures') = 'array'
      AND snapshot.hook->'aggregateTvlExposures' <> '[]'::jsonb
  `, [strategies.map(ref => ref.chainId), strategies.map(ref => ref.address)])

  return result.rows
}
