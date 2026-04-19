export const ESTIMATED_APR_LABELS = [
  'aero-estimated-apr',
  'crv-estimated-apr',
  'katana-estimated-apr',
  'locked-yvusd-estimated-apr',
  'velo-estimated-apr',
  'yvusd-estimated-apr'
] as const

export type EstimatedAprLabel = typeof ESTIMATED_APR_LABELS[number]
