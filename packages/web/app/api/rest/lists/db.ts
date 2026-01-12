import db from '../../db'
import { z } from 'zod'

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
    decimals: z.number(),
  }).nullable(),

  // Financial metrics
  tvl: z.number().nullable(), // USD value
  apy: z.number().nullable(), // Net APY as decimal

  // Fees (basis points)
  fees: z.object({
    management: z.number(),
    performance: z.number(),
  }).nullable(),

  // Classification
  category: z.string().nullable(),
  type: z.string().nullable(), // 'Yearn Vault', 'Automated', etc
  kind: z.string().nullable(), // 'Multi Strategy', 'Single Strategy'

  // Flags
  v3: z.boolean(),
  yearn: z.boolean(),
  isRetired: z.boolean(),
  isHidden: z.boolean(),
  isBoosted: z.boolean(),
  isHighlighted: z.boolean(),

  // Strategies
  strategiesCount: z.number(),

  // Risk
  riskLevel: z.number().nullable(),
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
        snapshot.hook->'meta'->>'displayName',
        thing.defaults->>'name',
        snapshot.snapshot->>'name'
      ) AS name,

      -- Symbol
      COALESCE(
        snapshot.hook->'meta'->>'displaySymbol',
        snapshot.snapshot->>'symbol'
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

      -- Asset (as JSON object)
      jsonb_build_object(
        'address', snapshot.hook->'asset'->>'address',
        'name', snapshot.hook->'asset'->>'name',
        'symbol', snapshot.hook->'asset'->>'symbol',
        'decimals', (snapshot.hook->'asset'->>'decimals')::int
      ) AS asset,

      -- TVL (USD)
      (snapshot.hook->'tvl'->>'close')::numeric AS tvl,

      -- APY (net)
      (snapshot.hook->'apy'->>'net')::numeric AS apy,

      -- Fees
      jsonb_build_object(
        'management', COALESCE((snapshot.hook->'fees'->>'managementFee')::int, 0),
        'performance', COALESCE((snapshot.hook->'fees'->>'performanceFee')::int, 0)
      ) AS fees,

      -- Classification
      snapshot.hook->'meta'->>'category' AS category,
      snapshot.hook->'meta'->>'type' AS type,
      snapshot.hook->'meta'->>'kind' AS kind,

      -- Flags
      COALESCE((thing.defaults->>'v3')::boolean, false) AS v3,
      COALESCE((thing.defaults->>'yearn')::boolean, false) AS yearn,
      COALESCE((snapshot.hook->'meta'->>'isRetired')::boolean, false) AS "isRetired",
      COALESCE((snapshot.hook->'meta'->>'isHidden')::boolean, false) AS "isHidden",
      COALESCE((snapshot.hook->'meta'->>'isBoosted')::boolean, false) AS "isBoosted",
      COALESCE((snapshot.hook->'meta'->>'isHighlighted')::boolean, false) AS "isHighlighted",

      -- Strategies count
      COALESCE(jsonb_array_length(snapshot.hook->'strategies'), 0) AS "strategiesCount",

      -- Risk
      (snapshot.hook->'risk'->>'riskLevel')::int AS "riskLevel"

    FROM thing
    LEFT JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = 'vault'
    ORDER BY (snapshot.hook->'tvl'->>'close')::double precision DESC NULLS LAST
  `)

  return z.array(VaultListItemSchema).parse(result.rows)
}
