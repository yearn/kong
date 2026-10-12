export type AggregateTvlSnapshot = {
  chainId: number
  address: string
  hook: Record<string, unknown> | null
  mergedSnapshot: Record<string, unknown>
}

export type AggregateTvlStrategyRef = {
  chainId: number
  address: string
}

/**
 * Opt-in strategy snapshot contract for attributed indirect vault holdings.
 * `attributableUsd` must describe the target-vault share value owned through
 * this strategy specifically for the named parent vault.
 */
export type AggregateTvlExposure = {
  parentChainId: number
  parentVaultAddress: string
  targetChainId: number
  targetVaultAddress: string
  attributableUsd: number
}

export type AggregateTvlDeductionReason =
  | 'underlying-vault'
  | 'v3-debt'
  | 'v2-debt'
  | 'strategy-exposure'

export type AggregateTvlDeduction = {
  targetChainId: number
  targetAddress: string
  amount: number
  reason: AggregateTvlDeductionReason
}

export type AggregateTvlVault = {
  chainId: number
  address: string
  grossTvl: number
  deductedTvl: number
  contribution: number
  deductions: AggregateTvlDeduction[]
}

export type AggregateTvlChain = {
  chainId: number
  tvl: number
  grossTvl: number
  deductedTvl: number
}

export type AggregateTvlPayload = {
  tvl: number
  grossTvl: number
  deductedTvl: number
  updatedAt: string
  chains: AggregateTvlChain[]
  vaults: AggregateTvlVault[]
}

type InternalVault = AggregateTvlSnapshot & {
  grossTvl: number
  identity: string
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function address(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function chainId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function identity(chain: number, addr: string): string {
  return `${chain}:${addr}`
}

function snapshotTvl(snapshot: AggregateTvlSnapshot): number | null {
  const hook = asObject(snapshot.hook)
  const tvl = asObject(hook?.tvl)
  return amount(tvl?.close)
}

function normalizedRows(rows: AggregateTvlSnapshot[]): InternalVault[] {
  const unique = new Map<string, InternalVault>()

  for (const row of rows) {
    const chain = chainId(row?.chainId)
    const addr = address(row?.address)
    const grossTvl = snapshotTvl(row)
    if (chain == null || addr == null || grossTvl == null) continue

    const key = identity(chain, addr)
    if (!unique.has(key)) {
      unique.set(key, {
        ...row,
        chainId: chain,
        address: addr,
        grossTvl,
        identity: key,
      })
    }
  }

  return [...unique.values()].sort((a, b) => (
    a.chainId - b.chainId || a.address.localeCompare(b.address)
  ))
}

function getDebts(vault: InternalVault): Array<Record<string, unknown>> {
  const hook = asObject(vault.hook)
  const debts = hook?.debts
  return Array.isArray(debts)
    ? debts.map(asObject).filter((debt): debt is Record<string, unknown> => debt != null)
    : []
}

function getAssetAddress(vault: InternalVault): string | null {
  const asset = asObject(vault.mergedSnapshot?.asset)
  return address(asset?.address)
}

function isV3(vault: InternalVault): boolean {
  return vault.mergedSnapshot?.v3 === true
}

function strategyRefs(vault: InternalVault): Map<string, AggregateTvlStrategyRef> {
  const refs = new Map<string, AggregateTvlStrategyRef>()
  for (const debt of getDebts(vault)) {
    const addr = address(debt.strategy)
    if (addr) refs.set(identity(vault.chainId, addr), { chainId: vault.chainId, address: addr })
  }
  return refs
}

function parseExposure(value: unknown): AggregateTvlExposure | null {
  const exposure = asObject(value)
  if (!exposure) return null
  const parentChainId = chainId(exposure.parentChainId)
  const parentVaultAddress = address(exposure.parentVaultAddress)
  const targetChainId = chainId(exposure.targetChainId)
  const targetVaultAddress = address(exposure.targetVaultAddress)
  const attributableUsd = amount(exposure.attributableUsd)
  if (
    parentChainId == null ||
    parentVaultAddress == null ||
    targetChainId == null ||
    targetVaultAddress == null ||
    attributableUsd == null
  ) return null
  return { parentChainId, parentVaultAddress, targetChainId, targetVaultAddress, attributableUsd }
}

export function getAggregateTvlStrategyRefs(
  vaultSnapshots: AggregateTvlSnapshot[],
): AggregateTvlStrategyRef[] {
  const refs = new Map<string, AggregateTvlStrategyRef>()
  for (const vault of normalizedRows(vaultSnapshots)) {
    for (const [key, ref] of strategyRefs(vault)) refs.set(key, ref)
  }
  return [...refs.values()].sort((a, b) => (
    a.chainId - b.chainId || a.address.localeCompare(b.address)
  ))
}

function formatUpdatedAt(updatedAt: Date | string): string {
  if (typeof updatedAt === 'string') return updatedAt
  return updatedAt.toISOString()
}

/**
 * Calculate approximate aggregate TVL from current snapshots.
 *
 * Wrapper values take precedence. Direct vault allocations use raw hook debts
 * and the appropriate V2/V3 USD debt field. Indirect holdings are deducted
 * only when a relevant strategy snapshot publishes the explicit
 * `hook.aggregateTvlExposures` attribution contract.
 */
export function calculateAggregateTvl(
  vaultSnapshots: AggregateTvlSnapshot[],
  strategySnapshots: AggregateTvlSnapshot[] = [],
  updatedAt: Date | string = new Date(),
): AggregateTvlPayload {
  const vaults = normalizedRows(vaultSnapshots)
  const vaultByIdentity = new Map(vaults.map(vault => [vault.identity, vault]))
  const strategyByIdentity = new Map<string, AggregateTvlSnapshot>()

  for (const strategy of strategySnapshots) {
    const chain = chainId(strategy?.chainId)
    const addr = address(strategy?.address)
    if (chain == null || addr == null) continue
    const key = identity(chain, addr)
    if (!strategyByIdentity.has(key)) strategyByIdentity.set(key, strategy)
  }

  const vaultResults: AggregateTvlVault[] = vaults.map((vault) => {
    const deductions: AggregateTvlDeduction[] = []
    let remaining = vault.grossTvl

    const underlyingAddress = getAssetAddress(vault)
    const underlying = underlyingAddress
      ? vaultByIdentity.get(identity(vault.chainId, underlyingAddress))
      : undefined

    if (underlying && underlying.identity !== vault.identity) {
      deductions.push({
        targetChainId: underlying.chainId,
        targetAddress: underlying.address,
        amount: remaining,
        reason: 'underlying-vault',
      })
      return {
        chainId: vault.chainId,
        address: vault.address,
        grossTvl: vault.grossTvl,
        deductedTvl: vault.grossTvl,
        contribution: 0,
        deductions,
      }
    }

    const directByTarget = new Map<string, { target: InternalVault, requested: number }>()
    const parentStrategies = strategyRefs(vault)
    for (const debt of getDebts(vault)) {
      const strategyAddress = address(debt.strategy)
      if (!strategyAddress) continue
      const target = vaultByIdentity.get(identity(vault.chainId, strategyAddress))
      if (!target || target.identity === vault.identity) continue

      const rawDebt = isV3(vault) ? debt.currentDebtUsd : debt.totalDebtUsd
      const debtAmount = amount(rawDebt)
      if (debtAmount == null || debtAmount <= 0) continue

      // Repeated debt rows for one strategy describe the same position; take the largest.
      const current = directByTarget.get(target.identity)
      directByTarget.set(target.identity, {
        target,
        requested: Math.max(current?.requested ?? 0, debtAmount),
      })
    }

    const directDeductions = [...directByTarget.values()]
      .sort((a, b) => a.target.address.localeCompare(b.target.address))
    for (const { target, requested } of directDeductions) {
      const deducted = Math.min(requested, remaining)
      if (deducted <= 0) continue
      deductions.push({
        targetChainId: target.chainId,
        targetAddress: target.address,
        amount: deducted,
        reason: isV3(vault) ? 'v3-debt' : 'v2-debt',
      })
      remaining -= deducted
    }

    const indirectByTarget = new Map<string, { target: InternalVault, requested: number }>()
    for (const strategyRef of parentStrategies.keys()) {
      const strategy = strategyByIdentity.get(strategyRef)
      if (!strategy) continue

      // Stop tracing once a strategy is itself an included vault. Its own
      // contribution and deductions account for holdings beyond that boundary.
      if (vaultByIdentity.has(strategyRef)) continue

      const hook = asObject(strategy.hook)
      const exposures = hook?.aggregateTvlExposures
      if (!Array.isArray(exposures)) continue
      const perStrategyTarget = new Map<string, { target: InternalVault, requested: number }>()

      for (const value of exposures) {
        const exposure = parseExposure(value)
        if (
          !exposure ||
          exposure.parentChainId !== vault.chainId ||
          exposure.parentVaultAddress !== vault.address ||
          exposure.attributableUsd <= 0
        ) continue

        const target = vaultByIdentity.get(identity(exposure.targetChainId, exposure.targetVaultAddress))
        if (!target || target.identity === vault.identity) continue

        const current = perStrategyTarget.get(target.identity)
        perStrategyTarget.set(target.identity, {
          target,
          requested: Math.max(current?.requested ?? 0, exposure.attributableUsd),
        })
      }

      // Repeated entries for one strategy, parent and target describe the same
      // position. Distinct intermediary strategies represent separate holdings.
      for (const [targetIdentity, exposure] of perStrategyTarget) {
        const current = indirectByTarget.get(targetIdentity)
        indirectByTarget.set(targetIdentity, {
          target: exposure.target,
          requested: (current?.requested ?? 0) + exposure.requested,
        })
      }
    }

    const indirectDeductions = [...indirectByTarget.values()]
      .sort((a, b) => (
        a.target.chainId - b.target.chainId ||
        a.target.address.localeCompare(b.target.address)
      ))
    for (const { target, requested } of indirectDeductions) {
      const deducted = Math.min(requested, remaining)
      if (deducted <= 0) continue
      deductions.push({
        targetChainId: target.chainId,
        targetAddress: target.address,
        amount: deducted,
        reason: 'strategy-exposure',
      })
      remaining -= deducted
    }

    const deductedTvl = vault.grossTvl - remaining
    return {
      chainId: vault.chainId,
      address: vault.address,
      grossTvl: vault.grossTvl,
      deductedTvl,
      contribution: remaining,
      deductions,
    }
  })

  const totalsByChain = new Map<number, { grossTvl: number, deductedTvl: number, tvl: number }>()
  for (const vault of vaultResults) {
    const current = totalsByChain.get(vault.chainId) ?? { grossTvl: 0, deductedTvl: 0, tvl: 0 }
    current.grossTvl += vault.grossTvl
    current.deductedTvl += vault.deductedTvl
    current.tvl += vault.contribution
    totalsByChain.set(vault.chainId, current)
  }

  const chains: AggregateTvlChain[] = [...totalsByChain.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, totals]) => ({ chainId: id, ...totals }))

  const grossTvl = chains.reduce((sum, chain) => sum + chain.grossTvl, 0)
  const deductedTvl = chains.reduce((sum, chain) => sum + chain.deductedTvl, 0)
  const tvl = chains.reduce((sum, chain) => sum + chain.tvl, 0)

  return {
    tvl,
    grossTvl,
    deductedTvl,
    updatedAt: formatUpdatedAt(updatedAt),
    chains,
    vaults: vaultResults,
  }
}
