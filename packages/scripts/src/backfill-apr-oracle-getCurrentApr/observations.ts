export type OracleObservation = {
  chain_id: number
  address: `0x${string}`
  block_number: string | bigint
  block_time: bigint
  series_time: bigint
}

export type OracleComponents = {
  apr: number
  apy: number
  netApr: number
  netApy: number
}

export type OracleTempRow = {
  chain_id: number
  address: `0x${string}`
  label: string
  component: string
  value: number
  block_number: bigint
  block_time: bigint
  series_time: bigint
}

/** Stable key for one exact source observation; component rows share this key. */
export function oracleObservationKey(row: OracleObservation): string {
  return JSON.stringify([
    row.chain_id,
    row.address.toLowerCase(),
    String(row.block_number),
    String(row.block_time),
    String(row.series_time),
  ])
}

/** Build all corrected components while retaining source block and observation timestamps. */
export function toOracleTempRows(
  observation: OracleObservation,
  components: OracleComponents,
): OracleTempRow[] {
  const blockNumber = BigInt(observation.block_number)
  const base = {
    chain_id: observation.chain_id,
    address: observation.address,
    label: 'apr-oracle',
    block_number: blockNumber,
    block_time: observation.block_time,
    series_time: observation.series_time,
  }

  return [
    { ...base, component: 'apr', value: components.apr },
    { ...base, component: 'apy', value: components.apy },
    { ...base, component: 'netApr', value: components.netApr },
    { ...base, component: 'netApy', value: components.netApy },
  ]
}
