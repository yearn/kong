import { describe, expect, it } from 'vitest'
import { oracleObservationKey, toOracleTempRows } from './observations'

const firstObservation = {
  chain_id: 1,
  address: '0xAbCd' as `0x${string}`,
  block_number: '123',
  block_time: 1_700_000_001n,
  series_time: 1_700_086_399n,
}

describe('apr-oracle observation staging', () => {
  it('keys an exact observation by chain, normalized address, block, and both times', () => {
    const duplicate = { ...firstObservation, address: '0xabcd' as `0x${string}` }
    const nextObservationDay = { ...firstObservation, series_time: 1_700_172_799n }
    const nextBlock = { ...firstObservation, block_number: '124' }
    const nextBlockTime = { ...firstObservation, block_time: 1_700_000_002n }
    const otherChain = { ...firstObservation, chain_id: 10 }

    expect(oracleObservationKey(firstObservation)).toBe(oracleObservationKey(duplicate))
    expect(oracleObservationKey(firstObservation)).not.toBe(oracleObservationKey(nextObservationDay))
    expect(oracleObservationKey(firstObservation)).not.toBe(oracleObservationKey(nextBlock))
    expect(oracleObservationKey(firstObservation)).not.toBe(oracleObservationKey(nextBlockTime))
    expect(oracleObservationKey(firstObservation)).not.toBe(oracleObservationKey(otherChain))
  })

  it('stages every corrected component with the source block time and series time independently', () => {
    expect(toOracleTempRows(firstObservation, {
      apr: 0.1,
      apy: 0.105,
      netApr: 0.08,
      netApy: 0.083,
    })).toEqual([
      { chain_id: 1, address: '0xAbCd', label: 'apr-oracle', component: 'apr', value: 0.1, block_number: 123n, block_time: 1_700_000_001n, series_time: 1_700_086_399n },
      { chain_id: 1, address: '0xAbCd', label: 'apr-oracle', component: 'apy', value: 0.105, block_number: 123n, block_time: 1_700_000_001n, series_time: 1_700_086_399n },
      { chain_id: 1, address: '0xAbCd', label: 'apr-oracle', component: 'netApr', value: 0.08, block_number: 123n, block_time: 1_700_000_001n, series_time: 1_700_086_399n },
      { chain_id: 1, address: '0xAbCd', label: 'apr-oracle', component: 'netApy', value: 0.083, block_number: 123n, block_time: 1_700_000_001n, series_time: 1_700_086_399n },
    ])
  })
})
