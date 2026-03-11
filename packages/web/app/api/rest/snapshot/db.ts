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
 * Get vault snapshot (same query as GraphQL vault resolver)
 * Combines thing.defaults, snapshot.snapshot, and snapshot.hook
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
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
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
    ...row.defaults,
    ...row.snapshot,
    ...row.hook
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
