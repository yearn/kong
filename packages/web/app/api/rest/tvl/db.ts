import type { Pool } from 'pg'
import { EvmAddressSchema } from 'lib/types'
import { mergedJsonSql } from '../../../../lib/mergeSnapshot'
import { buildVaultFilters } from '../../../../lib/vaultFilters'
import { cronDb } from '../../db/cron'
import type { AggregateTvlSnapshot, AggregateTvlStrategyRef, AggregateTvlStrategySnapshot } from './aggregate'

type VaultDbRow = Omit<AggregateTvlSnapshot, 'chainId'> & { chainId: number | string }

function selectVaultSnapshots(where: string): string {
  // Project nested fields in PostgreSQL so unused snapshot data never leaves the database.
  return `
    SELECT
      thing.chain_id AS "chainId",
      thing.address,
      CASE WHEN snapshot.hook IS NULL THEN NULL ELSE jsonb_build_object(
        'tvl', jsonb_build_object('close', snapshot.hook->'tvl'->'close'),
        'debts', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'strategy', debt->'strategy',
            CASE WHEN ${mergedJsonSql('v3')} = to_jsonb(true)
              THEN 'currentDebtUsd' ELSE 'totalDebtUsd' END,
            CASE WHEN ${mergedJsonSql('v3')} = to_jsonb(true)
              THEN debt->'currentDebtUsd' ELSE debt->'totalDebtUsd' END
          ) ORDER BY debt_index)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(snapshot.hook->'debts') = 'array'
              THEN snapshot.hook->'debts' ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS debts(debt, debt_index)
          WHERE jsonb_typeof(debt) = 'object'
        ), '[]'::jsonb)
      ) END AS hook,
      jsonb_build_object(
        'asset', jsonb_build_object(
          'address', COALESCE(NULLIF(snapshot.hook->'asset', 'null'::jsonb), ${mergedJsonSql('asset')})->'address'
        ),
        'v3', ${mergedJsonSql('v3')}
      ) AS "mergedSnapshot"
    FROM thing
    INNER JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE ${where}
      -- Leave IEEE-754 rounding boundaries to the calculator: tiny negatives
      -- can parse as -0, and values just above MAX_VALUE can round down to it.
      AND CASE WHEN jsonb_typeof(snapshot.hook->'tvl'->'close') = 'number'
        THEN (snapshot.hook->'tvl'->>'close')::numeric BETWEEN -5e-324::numeric AND 1.8e308::numeric
        ELSE false END
  `
}

/** Read Yearn vault rows and their snapshots in one query. */
export async function getAggregateVaults(pool: Pool = cronDb): Promise<AggregateTvlSnapshot[]> {
  const { where, params } = buildVaultFilters({ yearn: true })
  const excludeRetiredHiddenV3 = `NOT (
        (${mergedJsonSql('v3')} = to_jsonb(true)) IS TRUE
        AND COALESCE((snapshot.hook->'meta'->>'isRetired')::boolean, false)
        AND COALESCE((snapshot.hook->'meta'->>'isHidden')::boolean, false)
      )`
  const result = await pool.query<VaultDbRow>(
    selectVaultSnapshots(`${where}\n      AND ${excludeRetiredHiddenV3}`),
    params,
  )
  return result.rows.map(row => ({ ...row, chainId: Number(row.chainId) }))
}

/**
 * Batch-read only strategy snapshots referenced by the selected vaults.
 * Only projected exposures and mapped targets leave the database.
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
      jsonb_strip_nulls(jsonb_build_object(
        'aggregateTvlExposures', snapshot.hook->'aggregateTvlExposures',
        'aggregateTvlTarget', snapshot.hook->'aggregateTvlTarget'
      )) AS hook
    FROM unnest($1::int[], $2::text[]) AS requested(chain_id, address)
    INNER JOIN thing
      ON requested.chain_id = thing.chain_id
      AND requested.address = thing.address
      AND thing.label = 'strategy'
    INNER JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE (jsonb_typeof(snapshot.hook->'aggregateTvlExposures') = 'array'
        AND snapshot.hook->'aggregateTvlExposures' <> '[]'::jsonb)
      OR jsonb_typeof(snapshot.hook->'aggregateTvlTarget') = 'object'
  `, [strategies.map(ref => ref.chainId), strategies.map(ref => ref.address)])

  return result.rows
}
