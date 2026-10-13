export type AggregateTvlSnapshot = {
  chainId: number
  address: string
  hook: Record<string, unknown> | null
  mergedSnapshot: Record<string, unknown>
}

export type AggregateTvlStrategySnapshot = Pick<AggregateTvlSnapshot, 'chainId' | 'address' | 'hook'>

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

  return Array.from(unique.values()).sort((a, b) => (
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
  const vaults = normalizedRows(vaultSnapshots)
  const included = new Set(vaults.map(vault => vault.identity))
  for (const vault of vaults) {
    for (const [key, ref] of Array.from(strategyRefs(vault))) {
      if (!included.has(key)) refs.set(key, ref)
    }
  }
  return Array.from(refs.values()).sort((a, b) => (
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
  strategySnapshots: AggregateTvlStrategySnapshot[] = [],
  updatedAt: Date | string = new Date(),
): AggregateTvlPayload {
  const vaults = normalizedRows(vaultSnapshots)
  const vaultByIdentity = new Map(vaults.map(vault => [vault.identity, vault]))
  const strategyByIdentity = new Map<string, AggregateTvlStrategySnapshot>()

  for (const strategy of strategySnapshots) {
    const chain = chainId(strategy?.chainId)
    const addr = address(strategy?.address)
    if (chain == null || addr == null) continue
    const key = identity(chain, addr)
    if (!strategyByIdentity.has(key)) strategyByIdentity.set(key, strategy)
  }

  const childBudget = new Map(vaults.map(vault => [vault.identity, vault.grossTvl]))

  const vaultResults: AggregateTvlVault[] = vaults.map((vault) => {
    const deductions: AggregateTvlDeduction[] = []
    let remaining = vault.grossTvl
    const deduct = (target: InternalVault, requested: number, reason: AggregateTvlDeductionReason) => {
      const amount = Math.min(requested, remaining, childBudget.get(target.identity) ?? 0)
      if (amount <= 0) return
      deductions.push({ targetChainId: target.chainId, targetAddress: target.address, amount, reason })
      childBudget.set(target.identity, (childBudget.get(target.identity) ?? 0) - amount)
      remaining -= amount
    }

    const underlyingAddress = getAssetAddress(vault)
    const underlying = underlyingAddress
      ? vaultByIdentity.get(identity(vault.chainId, underlyingAddress))
      : undefined

    if (underlying && underlying.identity !== vault.identity) {
      deduct(underlying, remaining, 'underlying-vault')
      return {
        chainId: vault.chainId,
        address: vault.address,
        grossTvl: vault.grossTvl,
        deductedTvl: vault.grossTvl - remaining,
        contribution: remaining,
        deductions,
      }
    }

    // Repeated debt rows for one strategy describe the same position; take the largest.
    const debtByStrategy = new Map<string, number>()
    for (const debt of getDebts(vault)) {
      const strategyAddress = address(debt.strategy)
      const debtAmount = amount(isV3(vault) ? debt.currentDebtUsd : debt.totalDebtUsd)
      if (!strategyAddress || debtAmount == null || debtAmount <= 0) continue
      const key = identity(vault.chainId, strategyAddress)
      debtByStrategy.set(key, Math.max(debtByStrategy.get(key) ?? 0, debtAmount))
    }

    const parentStrategies = strategyRefs(vault)
    const directDeductions = Array.from(debtByStrategy)
      .map(([key, requested]) => ({ target: vaultByIdentity.get(key), requested }))
      .filter((d): d is { target: InternalVault, requested: number } => !!d.target && d.target.identity !== vault.identity)
      .sort((a, b) => a.target.address.localeCompare(b.target.address))
    for (const { target, requested } of directDeductions) {
      deduct(target, requested, isV3(vault) ? 'v3-debt' : 'v2-debt')
    }

    const indirectByTarget = new Map<string, { target: InternalVault, requested: number }>()
    for (const strategyRef of Array.from(parentStrategies.keys())) {
      const strategy = strategyByIdentity.get(strategyRef)
      if (!strategy) continue

      // Stop tracing once a strategy is itself an included vault. Its own
      // contribution and deductions account for holdings beyond that boundary.
      if (vaultByIdentity.has(strategyRef)) continue

      const hook = asObject(strategy.hook)
      const rawExposures = hook?.aggregateTvlExposures
      const exposures = Array.isArray(rawExposures) ? rawExposures : []
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

      // Without an observed exposure, estimate the overlap from the parent's recorded debt.
      const mapped = asObject(hook?.aggregateTvlTarget)
      const mappedChain = chainId(mapped?.chainId)
      const mappedAddress = address(mapped?.address)
      const mappedTarget = mappedChain != null && mappedAddress != null
        ? vaultByIdentity.get(identity(mappedChain, mappedAddress))
        : undefined
      const parentDebt = debtByStrategy.get(strategyRef) ?? 0
      if (perStrategyTarget.size === 0 && mappedTarget && mappedTarget.identity !== vault.identity && parentDebt > 0) {
        perStrategyTarget.set(mappedTarget.identity, { target: mappedTarget, requested: parentDebt })
      }

      // Repeated entries for one strategy, parent and target describe the same
      // position. Distinct intermediary strategies represent separate holdings.
      for (const [targetIdentity, exposure] of Array.from(perStrategyTarget)) {
        const current = indirectByTarget.get(targetIdentity)
        indirectByTarget.set(targetIdentity, {
          target: exposure.target,
          requested: (current?.requested ?? 0) + exposure.requested,
        })
      }
    }

    const indirectDeductions = Array.from(indirectByTarget.values())
      .sort((a, b) => (
        a.target.chainId - b.target.chainId ||
        a.target.address.localeCompare(b.target.address)
      ))
    for (const { target, requested } of indirectDeductions) {
      deduct(target, requested, 'strategy-exposure')
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

  const chains: AggregateTvlChain[] = Array.from(totalsByChain.entries())
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
