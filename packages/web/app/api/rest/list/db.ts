import { z } from 'zod'
import db from '../../db'

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
      apy: CoerceNumber,
    }).nullish(),
    historical: z.object({
      net: CoerceNumber,
      weeklyNet: CoerceNumber,
      monthlyNet: CoerceNumber,
      inceptionNet: CoerceNumber,
    }).nullish(),
    estimated: z.object({
      apr: z.number(),
      apy: z.number(),
      type: z.string(),
      components: z.object({
        boost: z.number().nullish(),
        poolAPY: z.number().nullish(),
        boostedAPR: z.number().nullish(),
        baseAPR: z.number().nullish(),
        rewardsAPR: z.number().nullish(),
        rewardsAPY: z.number().nullish(),
        cvxAPR: z.number().nullish(),
        keepCRV: z.number().nullish(),
        keepVelo: z.number().nullish()
      })
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
})

export type VaultListItem = z.infer<typeof VaultListItemSchema>

/**
 * Get all vaults with expanded metadata for listing
 * Uses Zod to ensure only specified fields are returned
 *
 * @returns All vaults with rich metadata
 */
export async function getVaultsList(): Promise<VaultListItem[]> {
  const result = await db.query(`
    SELECT DISTINCT
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
      thing.defaults->>'origin' AS origin

    FROM thing
    LEFT JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = 'vault'
    ORDER BY (snapshot.hook->'tvl'->>'close')::double precision DESC NULLS LAST
  `)

  return z.array(VaultListItemSchema).parse(result.rows)
}
