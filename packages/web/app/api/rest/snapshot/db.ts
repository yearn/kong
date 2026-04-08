import db from '../../db'
import { getAddress } from 'viem'

export type VaultRow = {
  chainId: number
  address: string
}

export type VaultSnapshot = {
  chainId: number
  address: string
  [key: string]: unknown
}

/**
 * Get all vaults
 * Used by refresh workflow to iterate over all vaults
 *
 * @returns All vaults with chainId and address
 */
export async function getVaults(): Promise<VaultRow[]> {
  const result = await db.query(`
    SELECT DISTINCT
      chain_id AS "chainId",
      address
    FROM thing
    WHERE label = 'vault'
    ORDER BY chain_id, address
  `)

  return result.rows as VaultRow[]
}

/**
 * Get vault snapshot with selective field extraction to minimize egress.
 * Extracts only consumed fields from thing.defaults, snapshot.snapshot, and snapshot.hook JSONB
 * instead of transferring full blobs. Strips unused fields from composition[], debts[], apy,
 * tvl, and meta to reduce data transfer. Replaces strategies[] array with strategiesCount integer.
 *
 * @param chainId - Chain ID
 * @param address - Vault address
 * @returns Vault snapshot object or null if not found
 */
export async function getVaultSnapshot(
  chainId: number,
  address: string
): Promise<VaultSnapshot | null> {
  const result = await db.query(`
    SELECT
      thing.chain_id AS "chainId",
      thing.address,

      -- Scalars with V2/V3 fallback
      COALESCE(thing.defaults->>'apiVersion', snapshot.snapshot->>'apiVersion') AS "apiVersion",
      thing.defaults->'inceptTime' AS "inceptTime",
      COALESCE(snapshot.snapshot->>'name', thing.defaults->>'name', snapshot.hook->'meta'->>'name') AS name,
      COALESCE(snapshot.snapshot->>'symbol', snapshot.hook->'meta'->>'displaySymbol') AS symbol,
      COALESCE(thing.defaults->'decimals', snapshot.snapshot->'decimals') AS decimals,
      snapshot.snapshot->>'totalDebt' AS "totalDebt",
      snapshot.snapshot->>'totalAssets' AS "totalAssets",
      snapshot.snapshot->>'pricePerShare' AS "pricePerShare",

      -- strategiesCount replaces full strategies[] array
      COALESCE(jsonb_array_length(snapshot.hook->'strategies'), 0) AS "strategiesCount",

      -- Pass-through hook objects (all fields used)
      snapshot.hook->'asset' AS asset,
      snapshot.hook->'risk' AS risk,
      snapshot.hook->'staking' AS staking,
      snapshot.hook->'performance' AS performance,
      snapshot.hook->'sparklines' AS sparklines,

      -- Fees: V3 hook.fees preferred, V2 fallback to snapshot scalars
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

      -- apy: strip unused grossApr
      (snapshot.hook->'apy') - 'grossApr' AS apy,

      -- tvl: keep only close (strip unused label, component)
      CASE WHEN snapshot.hook->'tvl' IS NOT NULL THEN
        jsonb_build_object('close', snapshot.hook->'tvl'->'close')
      ELSE NULL END AS tvl,

      -- meta: strip unused address, chainId, shouldUseV2APR
      -- meta.token: strip unused displayName, displaySymbol, category
      CASE WHEN snapshot.hook->'meta' IS NOT NULL THEN
        CASE WHEN snapshot.hook->'meta'->'token' IS NOT NULL THEN
          jsonb_set(
            (snapshot.hook->'meta') - 'address' - 'chainId' - 'shouldUseV2APR',
            '{token}',
            (snapshot.hook->'meta'->'token') - 'displayName' - 'displaySymbol' - 'category'
          )
        ELSE
          (snapshot.hook->'meta') - 'address' - 'chainId' - 'shouldUseV2APR'
        END
      ELSE NULL END AS meta,

      -- composition[]: strip unused maxDebt, totalDebtUsd, totalGainUsd, totalLossUsd per element
      COALESCE(
        (SELECT jsonb_agg(elem - 'maxDebt' - 'totalDebtUsd' - 'totalGainUsd' - 'totalLossUsd')
         FROM jsonb_array_elements(snapshot.hook->'composition') AS elem),
        '[]'::jsonb
      ) AS composition,

      -- debts[]: strip unused maxDebt, targetDebtRatio, maxDebtRatio, currentDebtUsd, maxDebtUsd per element
      COALESCE(
        (SELECT jsonb_agg(elem - 'maxDebt' - 'targetDebtRatio' - 'maxDebtRatio' - 'currentDebtUsd' - 'maxDebtUsd')
         FROM jsonb_array_elements(snapshot.hook->'debts') AS elem),
        '[]'::jsonb
      ) AS debts

    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.chain_id = $1
      AND thing.address = $2
      AND thing.label = $3
  `, [chainId, getAddress(address as `0x${string}`), 'vault'])

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  const snapshot: VaultSnapshot = {
    chainId: row.chainId,
    address: row.address,
    apiVersion: row.apiVersion,
    inceptTime: row.inceptTime,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    totalDebt: row.totalDebt,
    totalAssets: row.totalAssets,
    pricePerShare: row.pricePerShare,
    strategiesCount: row.strategiesCount,
    asset: row.asset,
    fees: row.fees,
    risk: row.risk,
    staking: row.staking,
    performance: row.performance,
    sparklines: row.sparklines,
    apy: row.apy,
    tvl: row.tvl,
    meta: row.meta,
    composition: row.composition,
    debts: row.debts,
  }

  return await hydrateStrategyEstimatedApr(chainId, row.address, snapshot)
}

type EstimatedMetric = 'apr' | 'apy'

type StrategyEstimated = {
  apr?: number
  apy?: number
}

type OutputMetricRow = {
  address: string
  component: string | null
  value: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return getAddress(value as `0x${string}`).toLowerCase()
  } catch {
    return undefined
  }
}

function parseMetric(component: string): EstimatedMetric | undefined {
  const normalized = component.toLowerCase()
  if (normalized.includes('apy')) return 'apy'
  if (normalized.includes('apr')) return 'apr'
  return undefined
}

function setStrategyMetric(
  map: Map<string, StrategyEstimated>,
  strategyAddress: string,
  metric: EstimatedMetric,
  value: number
) {
  const current = map.get(strategyAddress) ?? {}
  current[metric] = value
  map.set(strategyAddress, current)
}

function parseComponentStrategyMetric(
  component: string,
  strategyAddresses: Set<string>
): { strategyAddress: string, metric: EstimatedMetric } | undefined {
  const addressMatch = component.match(/0x[a-fA-F0-9]{40}/)
  if (!addressMatch) return undefined

  const strategyAddress = normalizeAddress(addressMatch[0])
  if (!strategyAddress || !strategyAddresses.has(strategyAddress)) return undefined

  const metric = parseMetric(component)
  if (!metric) return undefined

  return { strategyAddress, metric }
}

async function resolveEstimatedAprLabel(
  chainId: number,
  vaultAddress: string,
  snapshot: VaultSnapshot
): Promise<string | undefined> {
  const performance = isRecord(snapshot.performance) ? snapshot.performance : undefined
  const estimated = performance && isRecord(performance.estimated) ? performance.estimated : undefined
  const estimatedType = estimated?.type

  if (typeof estimatedType === 'string' && estimatedType.endsWith('-estimated-apr')) {
    return estimatedType
  }

  const latest = await db.query(`
    SELECT label
    FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label LIKE '%-estimated-apr'
    ORDER BY block_time DESC
    LIMIT 1
  `, [chainId, vaultAddress])

  const label = latest.rows[0]?.label
  return typeof label === 'string' ? label : undefined
}

async function fetchLatestEstimatedAprRows(
  chainId: number,
  vaultAddress: string,
  strategyAddresses: string[],
  label: string
): Promise<OutputMetricRow[]> {
  const rows = await db.query(`
    WITH latest AS (
      SELECT block_time
      FROM output
      WHERE chain_id = $1
        AND address = $2
        AND label = $3
      ORDER BY block_time DESC
      LIMIT 1
    )
    SELECT
      address,
      component,
      value
    FROM output
    WHERE chain_id = $1
      AND label = $3
      AND block_time = (SELECT block_time FROM latest)
      AND (address = $2 OR address = ANY($4))
  `, [chainId, vaultAddress, label, strategyAddresses])

  return rows.rows as OutputMetricRow[]
}

async function hydrateStrategyEstimatedApr(
  chainId: number,
  vaultAddress: string,
  snapshot: VaultSnapshot
): Promise<VaultSnapshot> {
  if (!Array.isArray(snapshot.composition) || snapshot.composition.length === 0) {
    return snapshot
  }

  const strategies = snapshot.composition
    .filter(isRecord)
    .map(item => normalizeAddress(item.address))
    .filter((address): address is string => !!address)

  if (strategies.length === 0) return snapshot

  const label = await resolveEstimatedAprLabel(chainId, vaultAddress, snapshot)
  if (!label) return snapshot

  const rows = await fetchLatestEstimatedAprRows(chainId, vaultAddress, strategies, label)
  if (!rows.length) return snapshot

  const strategySet = new Set(strategies)
  const mapped = new Map<string, StrategyEstimated>()

  for (const row of rows) {
    if (typeof row.value !== 'number' || !isFinite(row.value)) continue
    if (typeof row.component !== 'string') continue

    const rowAddress = normalizeAddress(row.address)
    const metric = parseMetric(row.component)

    if (rowAddress && strategySet.has(rowAddress) && metric) {
      setStrategyMetric(mapped, rowAddress, metric, row.value)
      continue
    }

    const parsed = parseComponentStrategyMetric(row.component, strategySet)
    if (!parsed) continue
    setStrategyMetric(mapped, parsed.strategyAddress, parsed.metric, row.value)
  }

  if (!mapped.size) return snapshot

  const composition = snapshot.composition.map(item => {
    if (!isRecord(item)) return item
    const address = normalizeAddress(item.address)
    if (!address) return item

    const estimated = mapped.get(address)
    if (!estimated || (estimated.apr == null && estimated.apy == null)) return item

    const currentPerformance = isRecord(item.performance) ? item.performance : {}
    const nextEstimated: Record<string, unknown> = {
      ...(isRecord(currentPerformance.estimated) ? currentPerformance.estimated : {}),
      ...(estimated.apr != null ? { apr: estimated.apr } : {}),
      ...(estimated.apy != null ? { apy: estimated.apy } : {}),
      type: label,
    }

    return {
      ...item,
      performance: {
        ...currentPerformance,
        estimated: nextEstimated,
      },
    }
  })

  return {
    ...snapshot,
    composition,
  }
}
