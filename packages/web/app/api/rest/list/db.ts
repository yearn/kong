import { z } from 'zod'
import db from '../../db'
import type { VaultSnapshot } from '../snapshot/db'

const CoerceNumber = z.preprocess(
  (val) => (val === null || val === undefined) ? null : Number(val),
  z.number().nullable()
)

export const VaultListItemSchema = z.object({
  // Core identification
  chainId: z.number(),
  address: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
  apiVersion: z.string().nullable(),
  decimals: z.number().nullable(),

  // Asset info
  asset: z.object({
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
    decimals: CoerceNumber,
  }).nullish(),

  // Financial metrics
  tvl: z.number().nullable(), // USD value

  // Performance (APY/APR measures)
  performance: z.object({
    oracle: z.object({
      apr: CoerceNumber,
      netAPR: CoerceNumber,
      apy: CoerceNumber,
      netAPY: CoerceNumber,
    }).nullish(),
    historical: z.object({
      net: CoerceNumber,
      weeklyNet: CoerceNumber,
      monthlyNet: CoerceNumber,
      inceptionNet: CoerceNumber,
    }).nullish(),
    estimated: z.object({
      apr: z.number().optional(),
      apy: z.number().optional(),
      type: z.string(),
      components: z.record(z.string(), z.union([z.number(), z.string()]).nullable()).optional(),
    }).nullish(),
  }).nullish(),

  // Fees (basis points)
  fees: z.object({
    managementFee: z.number(),
    performanceFee: z.number(),
  }).nullable(),

  // Classification
  category: z.string().nullable(),
  type: z.string().nullable(), // 'Yearn Vault', 'Automated', etc
  kind: z.string().nullable(), // 'Multi Strategy', 'Single Strategy'

  // Flags
  v3: z.boolean(),
  isRetired: z.boolean(),
  isHidden: z.boolean(),
  isBoosted: z.boolean(),
  isHighlighted: z.boolean(),

  // Inclusion
  inclusion: z.record(z.string(), z.boolean()),

  // Strategies
  strategiesCount: z.number(),

  // Risk
  riskLevel: z.number().nullable(),

  migration: z.boolean(),

  origin: z.string().nullable(),

  // Inception
  inceptBlock: CoerceNumber,
  inceptTime: CoerceNumber,

  // Staking
  staking: z.object({
    address: z.string().nullish(),
    available: z.boolean(),
  }).nullable(),

  // Price
  pricePerShare: CoerceNumber,
})

export type VaultListItem = z.infer<typeof VaultListItemSchema>

export type VaultWithSnapshot = {
  listItem: VaultListItem | null
  listError: z.ZodError | null
  snapshot: VaultSnapshot | null
}

/**
 * Get every vault with expanded listing metadata AND its full snapshot, in a
 * single pass over `thing` + `snapshot`.
 *
 * Replaces the previous two-script approach (one curated query for the list +
 * an N+1 query-per-vault loop for snapshots). The join is 1:1 because
 * `thing` is filtered to `label = 'vault'` and `snapshot` is keyed on
 * `(chain_id, address)`, so a single scan yields everything both caches need:
 *  - the curated list columns (extracted in SQL, parsed by the Zod schema)
 *  - the raw `defaults` / `snapshot` / `hook` blobs, merged in JS into the
 *    same shape the snapshot endpoint serves.
 *
 * List parsing is intentionally independent from snapshot construction: a
 * malformed list-only row should fail the list refresh, but it should not block
 * snapshot cache writes that only need chain/address plus the raw blobs.
 */
export async function getVaultsWithSnapshots(): Promise<VaultWithSnapshot[]> {
  const result = await db.query(`
    SELECT * FROM (
    SELECT DISTINCT ON (thing.chain_id, thing.address)
      thing.chain_id AS "chainId",
      thing.address,

      -- Name with fallback
      COALESCE(
        thing.defaults->>'name',
        snapshot.snapshot->>'name',
        snapshot.hook->'meta'->>'displayName'
      ) AS name,

      -- Symbol
      COALESCE(
        snapshot.snapshot->>'symbol',
        snapshot.hook->'meta'->>'displaySymbol'
      ) AS symbol,

      -- Version
      COALESCE(
        thing.defaults->>'apiVersion',
        snapshot.snapshot->>'apiVersion'
      ) AS "apiVersion",

      -- Decimals
      COALESCE(
        (thing.defaults->>'decimals')::int,
        (snapshot.snapshot->>'decimals')::int
      ) AS decimals,

      -- Asset
      snapshot.hook->'asset' AS asset,

      -- TVL (USD)
      (snapshot.hook->'tvl'->>'close')::double precision AS tvl,

      -- Performance (APY/APR measures)
      snapshot.hook->'performance' AS performance,

      -- Fees (coalesce v2 and v3 sources)
      COALESCE(
        snapshot.hook->'fees',
        CASE WHEN snapshot.snapshot->>'managementFee' IS NOT NULL
             OR snapshot.snapshot->>'performanceFee' IS NOT NULL
        THEN jsonb_build_object(
          'managementFee', COALESCE((snapshot.snapshot->>'managementFee')::int, 0),
          'performanceFee', COALESCE((snapshot.snapshot->>'performanceFee')::int, 0)
        )
        ELSE NULL END
      ) AS fees,

      -- Classification
      snapshot.hook->'meta'->>'category' AS category,
      snapshot.hook->'meta'->>'type' AS type,
      snapshot.hook->'meta'->>'kind' AS kind,

      -- Flags
      COALESCE((thing.defaults->>'v3')::boolean, false) AS v3,
      COALESCE((snapshot.hook->'meta'->>'isRetired')::boolean, false) AS "isRetired",
      COALESCE((snapshot.hook->'meta'->>'isHidden')::boolean, false) AS "isHidden",
      COALESCE((snapshot.hook->'meta'->>'isBoosted')::boolean, false) AS "isBoosted",
      COALESCE((snapshot.hook->'meta'->>'isHighlighted')::boolean, false) AS "isHighlighted",

      -- Inclusion
      COALESCE(snapshot.hook->'meta'->'inclusion', '{}'::jsonb) AS inclusion,

      -- Strategies count
      COALESCE(jsonb_array_length(snapshot.hook->'strategies'), 0) AS "strategiesCount",

      -- Risk
      (snapshot.hook->'risk'->>'riskLevel')::int AS "riskLevel",

      -- Migration
      COALESCE((snapshot.hook->'meta'->'migration'->>'available')::boolean, false) AS "migration",

      -- Origin
      thing.defaults->>'origin' AS origin,

      -- Inception
      (thing.defaults->>'inceptBlock')::bigint AS "inceptBlock",
      (thing.defaults->>'inceptTime')::bigint AS "inceptTime",

      -- Staking
      CASE WHEN snapshot.hook->'staking' IS NOT NULL THEN
        jsonb_build_object(
          'address', snapshot.hook->'staking'->>'address',
          'available', (snapshot.hook->'staking'->>'available')::boolean
        )
      ELSE NULL END AS staking,

      -- Price
      (snapshot.snapshot->>'pricePerShare')::numeric AS "pricePerShare",

      -- Raw blobs for the full snapshot cache (reused from the same scan)
      thing.defaults AS "_defaults",
      snapshot.snapshot AS "_snapshot",
      snapshot.hook AS "_hook",
      (snapshot.chain_id IS NOT NULL) AS "_hasSnapshot"

    FROM thing
    LEFT JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = 'vault'
    -- DISTINCT ON requires its key as the leading ORDER BY; the outer query restores TVL ordering.
    ORDER BY thing.chain_id, thing.address
    ) vaults
    ORDER BY tvl DESC NULLS LAST
  `)

  return result.rows.map((row) => {
    const { _defaults, _snapshot, _hook, _hasSnapshot, ...listColumns } = row
    const parsedListItem = VaultListItemSchema.safeParse(listColumns)

    // Mirror the snapshot endpoint's merge: defaults < snapshot < hook.
    const snapshot: VaultSnapshot | null = _hasSnapshot
      ? {
        chainId: row.chainId,
        address: row.address,
        ...(_defaults ?? {}),
        ...(_snapshot ?? {}),
        ...(_hook ?? {}),
      }
      : null

    return {
      listItem: parsedListItem.success ? parsedListItem.data : null,
      listError: parsedListItem.success ? null : parsedListItem.error,
      snapshot,
    }
  })
}
