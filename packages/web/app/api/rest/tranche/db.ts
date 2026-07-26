import db from '../../db'

/**
 * yTranche system state, assembled from what the indexer already stores:
 *
 *  - the controller's snapshot — its own state plus the ordered `tranches`
 *    accounting array its snapshot hook appends
 *  - each tranche's thing (metadata) and snapshot (`hook` address + `hookState`)
 *  - each tranche's latest `pps` output, which is controller-backed
 *
 * Asset amounts are normalized to the asset's decimals; `asset.decimals` is in
 * the payload so a consumer can recover raw units. Price per share carries both
 * the raw and humanized forms, matching the `pps` output's components.
 *
 * Everything is as of a block: the system fields come from the controller
 * snapshot's block, and each tranche carries its own snapshot block, since the
 * two are snapshotted independently.
 */

export type RateLimit = {
  used: number
  windowStart: number
  rateLimit: number
  // `used` counts within a fixed window that has expired once
  // blockTime >= windowStart + rateLimitWindow, at which point nothing is used.
  effectiveUsed: number
  remaining: number
}

export type TrancheEntry = {
  address: string
  name: string | null
  symbol: string | null
  decimals: number | null
  apiVersion: string | null
  priority: number | null
  trancheType: string | null
  inceptBlock: number | null
  inceptTime: number | null
  hook: string | null
  hookState: {
    open: boolean
    rateLimitWindow: number
    depositLimit: number
    depositRateLimit: RateLimit
    withdrawRateLimit: RateLimit
    depositCap: number
    withdrawCap: number
  } | null
  accounting: {
    registered: boolean
    accrualPaused: boolean
    excessShareBps: number
    targetRatePerSecondWad: string
    baselineAssets: number
    lastAccrual: number
    pendingExcess: number
    liveAssets: number
  } | null
  coverage: { claim: number, covered: number, ratio: number | null } | null
  pricePerShare: { raw: number | null, humanized: number | null } | null
  // Deliverable capacity, as the Hook derives it at the snapshot block — bounded
  // by aggregate limits, the fixed-window rate limits and, for withdrawals,
  // main-vault liquidity. Distinct from accounting coverage.
  capacity: {
    deposit: { cap: number, limit: number } | null
    withdraw: { cap: number } | null
  } | null
  blockNumber: number | null
  blockTime: number | null
}

export type TrancheSystem = {
  chainId: number
  controller: string
  asset: { address: string, name: string | null, symbol: string | null, decimals: number | null }
  mainVault: string | null
  reserveVault: string | null
  accounting: {
    totalClaims: number
    vaultAssets: number
    reserveAssets: number
    backingAssets: number
    vaultMaxWithdraw: number
    coverageRatio: number | null
  } | null
  tranches: TrancheEntry[]
  blockNumber: number | null
  blockTime: number | null
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function normalize(value: unknown, decimals: number | null): number {
  const raw = num(value)
  if (raw === null) return 0
  return raw / 10 ** (decimals ?? 0)
}

function toRateLimit(
  limit: Record<string, unknown> | undefined,
  window: number,
  blockTime: number | null,
  decimals: number | null,
): RateLimit {
  const used = normalize(limit?.used, decimals)
  const windowStart = num(limit?.windowStart) ?? 0
  const rateLimit = normalize(limit?.rateLimit, decimals)
  const expired = blockTime !== null && blockTime >= windowStart + window
  const effectiveUsed = expired ? 0 : used
  return {
    used,
    windowStart,
    rateLimit,
    effectiveUsed,
    remaining: Math.max(0, rateLimit - effectiveUsed),
  }
}

type ControllerRow = { chainId: number, controller: string }

export async function getTrancheControllers(): Promise<ControllerRow[]> {
  const result = await db.query(`
    SELECT DISTINCT
      chain_id AS "chainId",
      defaults->>'trancheController' AS controller
    FROM thing
    WHERE label = 'tranche'
      AND defaults->>'trancheController' IS NOT NULL
    ORDER BY chain_id, controller
  `)
  return result.rows as ControllerRow[]
}

export async function getTrancheSystems(): Promise<TrancheSystem[]> {
  const controllers = await getTrancheControllers()
  const systems: TrancheSystem[] = []

  for (const { chainId, controller } of controllers) {
    const system = await getTrancheSystem(chainId, controller)
    if (system) systems.push(system)
  }

  return systems
}

export async function getTrancheSystem(
  chainId: number,
  controller: string,
): Promise<TrancheSystem | null> {
  const controllerRows = await db.query(`
    SELECT
      snapshot,
      hook,
      block_number AS "blockNumber",
      block_time AS "blockTime"
    FROM snapshot
    WHERE chain_id = $1 AND lower(address) = lower($2)
  `, [chainId, controller])

  // No controller snapshot yet means nothing to serve — the tranches' own
  // accounting lives in that row.
  if (controllerRows.rows.length === 0) return null

  const { snapshot, hook, blockNumber, blockTime } = controllerRows.rows[0]
  const assetAddress = snapshot?.ASSET ?? null

  const assetRows = assetAddress
    ? await db.query(
      'SELECT defaults FROM thing WHERE chain_id = $1 AND lower(address) = lower($2) AND label = $3',
      [chainId, assetAddress, 'erc20'],
    )
    : { rows: [] }

  const assetDefaults = assetRows.rows[0]?.defaults ?? {}

  const trancheRows = await db.query(`
    SELECT
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook,
      snapshot.block_number AS "blockNumber",
      snapshot.block_time AS "blockTime"
    FROM thing
    LEFT JOIN snapshot
      ON snapshot.chain_id = thing.chain_id
      AND snapshot.address = thing.address
    WHERE thing.chain_id = $1
      AND thing.label = 'tranche'
      AND lower(thing.defaults->>'trancheController') = lower($2)
  `, [chainId, controller])

  const pps = await getLatestPricePerShare(
    chainId,
    trancheRows.rows.map((row) => row.address),
  )

  return buildTrancheSystem({
    chainId,
    controller,
    snapshot,
    hook,
    blockNumber,
    blockTime,
    assetDefaults,
    trancheRows: trancheRows.rows,
    pps,
  })
}

export type TrancheSystemRows = {
  chainId: number
  controller: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: Record<string, any> | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hook: Record<string, any> | null
  blockNumber: unknown
  blockTime: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetDefaults: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trancheRows: Record<string, any>[]
  pps: Map<string, { raw: number | null, humanized: number | null }>
}

// Shaping is separated from the queries so the payload's units, derivations and
// ordering can be exercised without a database.
export function buildTrancheSystem({
  chainId, controller, snapshot, hook, blockNumber, blockTime, assetDefaults, trancheRows, pps,
}: TrancheSystemRows): TrancheSystem {
  const assetAddress = snapshot?.ASSET ?? null
  const decimals = num(assetDefaults.decimals)

  // The controller's snapshot hook writes `tranches` in priority order; keying
  // by address lets each tranche pick up its own accounting.
  const accountingByAddress = new Map<string, Record<string, unknown>>(
    ((hook?.tranches ?? []) as Record<string, unknown>[])
      .map((entry) => [String(entry.address).toLowerCase(), entry]),
  )

  const tranches: TrancheEntry[] = trancheRows.map((row) => {
    const defaults = row.defaults ?? {}
    const trancheSnapshot = row.snapshot ?? {}
    const hookState = row.hook?.hookState ?? null
    const accounting = accountingByAddress.get(String(row.address).toLowerCase())
    const trancheDecimals = num(defaults.decimals) ?? decimals
    const rateLimitWindow = num(hookState?.rateLimitWindow) ?? 0
    const trancheBlockTime = num(row.blockTime)

    const claim = accounting ? normalize(accounting.claim, trancheDecimals) : null
    const covered = accounting ? normalize(accounting.covered, trancheDecimals) : null
    const ppsRow = pps.get(String(row.address).toLowerCase())

    return {
      address: row.address,
      name: defaults.name ?? trancheSnapshot.name ?? null,
      symbol: defaults.symbol ?? trancheSnapshot.symbol ?? null,
      decimals: trancheDecimals,
      apiVersion: defaults.apiVersion ?? trancheSnapshot.apiVersion ?? null,
      priority: num(defaults.priority ?? accounting?.priority),
      trancheType: defaults.trancheType ?? null,
      inceptBlock: num(defaults.inceptBlock),
      inceptTime: num(defaults.inceptTime),
      hook: trancheSnapshot.hook ?? null,
      hookState: hookState
        ? {
          open: Boolean(hookState.open),
          rateLimitWindow,
          depositLimit: normalize(hookState.depositLimit, trancheDecimals),
          depositRateLimit: toRateLimit(hookState.depositRateLimit, rateLimitWindow, trancheBlockTime, trancheDecimals),
          withdrawRateLimit: toRateLimit(hookState.withdrawRateLimit, rateLimitWindow, trancheBlockTime, trancheDecimals),
          depositCap: normalize(hookState.depositCap, trancheDecimals),
          withdrawCap: normalize(hookState.withdrawCap, trancheDecimals),
        }
        : null,
      accounting: accounting
        ? {
          registered: Boolean(accounting.registered),
          accrualPaused: Boolean(accounting.accrualPaused),
          excessShareBps: num(accounting.excessShareBps) ?? 0,
          targetRatePerSecondWad: String(accounting.targetRatePerSecondWad ?? '0'),
          baselineAssets: normalize(accounting.baselineAssets, trancheDecimals),
          lastAccrual: num(accounting.lastAccrual) ?? 0,
          pendingExcess: normalize(accounting.pendingExcess, trancheDecimals),
          liveAssets: normalize(accounting.liveAssets, trancheDecimals),
        }
        : null,
      coverage: claim !== null && covered !== null
        ? { claim, covered, ratio: claim > 0 ? covered / claim : null }
        : null,
      pricePerShare: ppsRow ?? null,
      capacity: hookState
        ? {
          deposit: {
            cap: normalize(hookState.depositCap, trancheDecimals),
            limit: normalize(hookState.depositLimit, trancheDecimals),
          },
          withdraw: { cap: normalize(hookState.withdrawCap, trancheDecimals) },
        }
        : null,
      blockNumber: num(row.blockNumber),
      blockTime: trancheBlockTime,
    }
  }).sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))

  const totalClaims = normalize(snapshot?.totalClaims, decimals)
  const backingAssets = normalize(snapshot?.backingAssets, decimals)
  const reserveVault = snapshot?.reserveVault ?? null

  return {
    chainId,
    controller,
    asset: {
      address: assetAddress,
      name: assetDefaults.name ?? null,
      symbol: assetDefaults.symbol ?? null,
      decimals,
    },
    mainVault: snapshot?.VAULT ?? null,
    // an unset reserve vault reads as the zero address on chain; report it as absent
    reserveVault: reserveVault === ZERO_ADDRESS ? null : reserveVault,
    accounting: {
      totalClaims,
      vaultAssets: normalize(snapshot?.vaultAssets, decimals),
      reserveAssets: normalize(snapshot?.reserveAssets, decimals),
      backingAssets,
      vaultMaxWithdraw: normalize(snapshot?.vaultMaxWithdraw, decimals),
      coverageRatio: totalClaims > 0 ? backingAssets / totalClaims : null,
    },
    tranches,
    blockNumber: num(blockNumber),
    blockTime: num(blockTime),
  }
}

async function getLatestPricePerShare(chainId: number, addresses: string[]) {
  const result = new Map<string, { raw: number | null, humanized: number | null }>()
  if (addresses.length === 0) return result

  const rows = await db.query(`
    SELECT DISTINCT ON (address, component)
      address,
      component,
      value
    FROM output
    WHERE chain_id = $1
      AND address = ANY($2)
      AND label = 'pps'
    ORDER BY address, component, series_time DESC
  `, [chainId, addresses])

  for (const row of rows.rows) {
    const key = String(row.address).toLowerCase()
    const entry = result.get(key) ?? { raw: null, humanized: null }
    if (row.component === 'raw') entry.raw = num(row.value)
    if (row.component === 'humanized') entry.humanized = num(row.value)
    result.set(key, entry)
  }

  return result
}
