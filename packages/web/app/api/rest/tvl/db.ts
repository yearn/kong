import type { Pool } from 'pg'
import { EvmAddressSchema } from 'lib/types'
import { mergedJsonSql } from '../../../../lib/mergeSnapshot'
import { buildVaultFilters } from '../../../../lib/vaultFilters'
import { cronDb } from '../../db/cron'
import type { AggregateTvlSnapshot, AggregateTvlStrategyRef, AggregateTvlStrategySnapshot } from './aggregate'
import { KNOWN_AGGREGATE_TVL_TARGETS } from './known-targets'

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
 * Read exposures and targets for referenced strategies, including reviewed
 * router mappings whose catalog entry or target observation is still missing.
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
    WITH candidates AS (
      SELECT requested.chain_id AS "chainId", requested.address,
        snapshot.hook->'aggregateTvlExposures' AS exposures,
        CASE WHEN snapshot.hook ? 'aggregateTvlTarget'
          THEN snapshot.hook->'aggregateTvlTarget'
          ELSE known.target END AS target
      FROM unnest($1::int[], $2::text[]) AS requested(chain_id, address)
      LEFT JOIN thing
        ON requested.chain_id = thing.chain_id
        AND requested.address = thing.address
        AND thing.label = 'strategy'
      LEFT JOIN snapshot
        ON requested.chain_id = snapshot.chain_id
        AND requested.address = snapshot.address
      LEFT JOIN jsonb_to_recordset($3::jsonb) AS known("chainId" int, address text, target jsonb)
        ON requested.chain_id = known."chainId"
        AND requested.address = known.address
      WHERE thing.address IS NOT NULL OR known.address IS NOT NULL
    )
    SELECT "chainId", address,
      jsonb_strip_nulls(jsonb_build_object(
        'aggregateTvlExposures', exposures,
        'aggregateTvlTarget', target
      )) AS hook
    FROM candidates
    WHERE (jsonb_typeof(exposures) = 'array' AND exposures <> '[]'::jsonb)
      OR jsonb_typeof(target) = 'object'
  `, [strategies.map(ref => ref.chainId), strategies.map(ref => ref.address), JSON.stringify(KNOWN_AGGREGATE_TVL_TARGETS)])

  return result.rows
}
