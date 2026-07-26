export type TimeseriesLabel = {
  label: string
  segment: string
  defaultComponent: string
  // Which addresses carry this label. The refresh scripts walk every vault, so
  // narrower scopes get their own pass instead of one query per vault.
  address?: 'vault' | 'tranche' | 'trancheController'
}

export const labels: TimeseriesLabel[] = [
  {
    label: 'pps',
    segment: 'pps',
    defaultComponent: 'humanized',
  },
  {
    label: 'apy-bwd-delta-pps',
    segment: 'apy-historical',
    defaultComponent: 'net',
  },
  {
    label: 'apr-oracle',
    segment: 'apr-oracle',
    defaultComponent: 'apr',
  },
  {
    label: 'tvl-c',
    segment: 'tvl',
    defaultComponent: 'tvl',
  },
  {
    label: 'tranche-accounting',
    segment: 'tranche-accounting',
    defaultComponent: 'liveAssets',
    address: 'tranche',
  },
  {
    label: 'tranche-system',
    segment: 'tranche-system',
    defaultComponent: 'backingAssets',
    address: 'trancheController',
  },
]

// Tranches are vaults, so they pick up pps, apy and tvl from the vault pass.
export const vaultLabels = labels.filter((label) => (label.address ?? 'vault') === 'vault')
export const trancheLabels = labels.filter((label) => label.address === 'tranche')
export const trancheControllerLabels = labels.filter((label) => label.address === 'trancheController')
