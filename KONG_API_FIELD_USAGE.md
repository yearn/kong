# Kong API Field Usage Audit

Per-entity breakdown of every field returned by the Kong REST API, annotated with usage status.
Fields marked `// UNUSED` are parsed by Zod but never read by any selector, hook, or component.

## Endpoints

| Endpoint | Hook | Cache | Schema File |
|---|---|---|---|
| `GET /list/vaults` | `useFetchYearnVaults` | 15 min | `kongVaultListSchema.ts` |
| `GET /snapshot/{chainId}/{address}` | `useVaultSnapshot` | 30s | `kongVaultSnapshotSchema.ts` |
| `GET /timeseries/{segment}/{chainId}/{address}` | `useVaultChartTimeseries` | — | raw JSON |

---

## Entity 1 — Vault List Item (`/list/vaults`)

```ts
interface KongVaultListItem {
  chainId: number
  address: string
  name: string
  symbol: string
  apiVersion: string
  decimals: number
  tvl: number
  category: string
  type: string
  kind: string
  v3: boolean
  yearn: boolean
  isRetired: boolean
  isHidden: boolean
  isBoosted: boolean
  isHighlighted: boolean
  inclusion: object
  origin: string
  migration: object
  strategiesCount: number
  riskLevel: number
  pricePerShare: string

  asset: {
    address: string
    name: string
    symbol: string
    decimals: number
  }

  fees: {
    managementFee: number
    performanceFee: number
  }

  staking: {
    address: string
    available: boolean
    source: string
    rewards: {
      address: string
      name: string
      symbol: string
      decimals: number
      price: number
      isFinished: boolean
      finishedAt: number
      apr: number
      perWeek: number
    }[]
  }

  performance: {
    oracle: {
      apr: number
      apy: number
    }

    estimated: {
      apr: number
      apy: number
      type: string

      components: {
        boost: number
        poolAPY: number
        boostedAPR: number
        baseAPR: number
        rewardsAPR: number
        cvxAPR: number
        keepCRV: number
        keepVelo: number
        katanaBonusAPY: number
        katanaAppRewardsAPR: number
        steerPointsPerDollar: number
        fixedRateKatanaRewards: number
        FixedRateKatanaRewards: number          // capitalization variant

        rewardsAPY: number                      // UNUSED — parsed, never read
        netAPR: number                          // UNUSED — parsed, never read
        netAPY: number                          // UNUSED — parsed, never read
      }
    }

    historical: {
      net: number
      weeklyNet: number
      monthlyNet: number
      inceptionNet: number
    }
  }
}
```

### List — unused fields (3)

| Field | Notes |
|---|---|
| `performance.estimated.components.rewardsAPY` | Never accessed in any selector |
| `performance.estimated.components.netAPR` | Never accessed in any selector |
| `performance.estimated.components.netAPY` | Never accessed in any selector |

---

## Entity 2 — Vault Snapshot (`/snapshot/{chainId}/{address}`)

```ts
interface KongVaultSnapshot {
  address: string
  chainId: number
  apiVersion: string
  inceptTime: number
  name: string
  symbol: string
  decimals: number
  totalDebt: string
  totalAssets: string
  inclusion: object
  strategies: string[]                          // UNUSED — only .length checked, replace with count

  apy: {
    net: number
    label: string
    weeklyNet: number
    monthlyNet: number
    inceptionNet: number
    pricePerShare: number
    weeklyPricePerShare: number
    monthlyPricePerShare: number

    grossApr: number                            // UNUSED — parsed, never read
  }

  tvl: {
    close: number

    label: string                               // UNUSED — parsed, never read
    component: string                           // UNUSED — parsed, never read
  }

  fees: {
    managementFee: number
    performanceFee: number
  }

  risk: {
    riskLevel: number
    riskScore: {
      review: number
      testing: number
      complexity: number
      riskExposure: number
      protocolIntegration: number
      centralizationRisk: number
      externalProtocolAudit: number
      externalProtocolCentralisation: number
      externalProtocolTvl: number
      externalProtocolLongevity: number
      externalProtocolType: number
      comment: string
    }
  }

  meta: {
    kind: string
    name: string
    type: string
    category: string
    isHidden: boolean
    isBoosted: boolean
    isRetired: boolean
    isHighlighted: boolean
    uiNotice: string
    sourceURI: string
    description: string
    displayName: string
    displaySymbol: string

    address: string                             // UNUSED — duplicates root address
    chainId: number                             // UNUSED — duplicates root chainId
    shouldUseV2APR: boolean                     // UNUSED — parsed, never read

    token: {
      address: string
      name: string
      symbol: string
      decimals: number
      description: string

      displayName: string                       // UNUSED — parsed, never accessed
      displaySymbol: string                     // UNUSED — parsed, never accessed
      category: string                          // UNUSED — parsed, never accessed
    }

    migration: {
      target: string
      contract: string
      available: boolean
    }
  }

  asset: {
    address: string
    name: string
    symbol: string
    decimals: number
  }

  performance: {
    oracle: {
      apr: number
      apy: number
    }

    estimated: {
      apr: number
      apy: number
      type: string

      components: {
        boost: number
        poolAPY: number
        boostedAPR: number
        baseAPR: number
        rewardsAPR: number
        cvxAPR: number
        keepCRV: number
        keepVelo: number
        katanaBonusAPY: number
        katanaAppRewardsAPR: number
        steerPointsPerDollar: number
        fixedRateKatanaRewards: number
        FixedRateKatanaRewards: number
        katRewardsAPR: number                   // snapshot-only, used in mapSnapshotComposition

        rewardsAPY: number                      // UNUSED — parsed, never read
        netAPR: number                          // UNUSED — parsed, never read
        netAPY: number                          // UNUSED — parsed, never read
      }
    }

    historical: {
      net: number
      weeklyNet: number
      monthlyNet: number
      inceptionNet: number
    }
  }

  staking: {
    address: string
    available: boolean
    source: string
    rewards: {
      address: string
      name: string
      symbol: string
      decimals: number
      price: number
      isFinished: boolean
      finishedAt: number
      apr: number
      perWeek: number
    }[]
  }

  composition: {
    address: string
    strategy: string
    name: string
    status: string
    debtRatio: number
    currentDebt: string
    totalDebt: string
    totalGain: string
    totalLoss: string
    performanceFee: number
    lastReport: number
    latestReportApr: number

    maxDebt: string                             // UNUSED — parsed, never read
    totalDebtUsd: number                        // UNUSED — parsed, never read
    totalGainUsd: number                        // UNUSED — parsed, never read
    totalLossUsd: number                        // UNUSED — parsed, never read

    performance: {
      estimated: {
        apy: number
        apr: number
        type: string
        components: {
          katRewardsAPR: number
        }
      }
      oracle: {
        apy: number
      }
      historical: {
        net: number
      }
    }
  }[]

  debts: {
    strategy: string
    currentDebt: string
    totalDebt: string
    totalGain: string
    totalLoss: string
    performanceFee: number
    lastReport: number
    debtRatio: number

    maxDebt: string                             // UNUSED — parsed, never read
    targetDebtRatio: number                     // UNUSED — parsed, never read
    maxDebtRatio: number                        // UNUSED — parsed, never read
    currentDebtUsd: number                      // UNUSED — parsed, never read
    maxDebtUsd: number                          // UNUSED — parsed, never read
  }[]
}
```

### Snapshot — unused fields (19)

| Field | Notes |
|---|---|
| `strategies[]` | Only `.length` checked — replace with integer count |
| `apy.grossApr` | Never read |
| `tvl.label` | Never read |
| `tvl.component` | Never read |
| `meta.address` | Duplicates root `address` |
| `meta.chainId` | Duplicates root `chainId` |
| `meta.shouldUseV2APR` | Never read |
| `meta.token.displayName` | Never accessed |
| `meta.token.displaySymbol` | Never accessed |
| `meta.token.category` | Never accessed |
| `composition[].maxDebt` | Never read in `mapSnapshotComposition` |
| `composition[].totalDebtUsd` | Never read |
| `composition[].totalGainUsd` | Never read |
| `composition[].totalLossUsd` | Never read |
| `debts[].maxDebt` | Never read in `mapSnapshotDebts` |
| `debts[].targetDebtRatio` | Never read |
| `debts[].maxDebtRatio` | Never read |
| `debts[].currentDebtUsd` | Never read |
| `debts[].maxDebtUsd` | Never read |

---

## Entity 3 — Timeseries (`/timeseries/{segment}/{chainId}/{address}`)

```ts
interface KongTimeseriesPoint {
  time: number
  value: number
  component: string                             // splits weeklyNet / monthlyNet series
  // Any other fields returned by Kong are silently ignored
}
```

Segments fetched: `apy-historical`, `tvl`, `pps`.

---

## Key source files

| File | Role |
|---|---|
| `src/components/shared/utils/schemas/kongVaultListSchema.ts` | Zod schema for `/list/vaults` |
| `src/components/shared/utils/schemas/kongVaultSnapshotSchema.ts` | Zod schema for `/snapshot` |
| `src/components/pages/vaults/domain/kongVaultSelectors.ts` | All field accessors, normalizes to `TKongVaultView` |
| `src/components/shared/hooks/useFetchYearnVaults.ts` | TanStack Query for list endpoint |
| `src/components/pages/vaults/hooks/useVaultSnapshot.ts` | TanStack Query for snapshot endpoint |
| `src/components/pages/vaults/hooks/useVaultChartTimeseries.ts` | Parallel fetches for chart data |
| `src/components/pages/vaults/domain/normalizeVault.ts` | yBOLD merging logic |
| `src/components/pages/vaults/utils/kongRest.ts` | Base URL constant |
