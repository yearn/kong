export type TimeseriesLabel = {
  label: string
  segment: string
  defaultComponent: string
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
]
