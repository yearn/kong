import db from '../../db'
import { getAddress } from 'viem'

export type VaultRow = {
  chainId: number
  address: string
}

export type TimeseriesRow = {
  chainId: number
  address: string
  label: string
  component: string
  value: number
  period?: string
  time: bigint
}

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

export async function getFullTimeseries(
  chainId: number,
  address: string,
  label: string,
): Promise<TimeseriesRow[]> {
  const result = await db.query(
    `
    SELECT
      chain_id AS "chainId",
      address,
      label,
      component,
      COALESCE(AVG(NULLIF(value, 0)), 0) AS value,
      '1 day'::text AS period,
      time_bucket('1 day'::interval, series_time) AS time
    FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label = $3
    GROUP BY chain_id, address, component, time
    ORDER BY time ASC
  `,
    [chainId, getAddress(address as `0x${string}`), label],
  )

  return result.rows as TimeseriesRow[]
}

export async function getLatestTimeseries(
  chainId: number,
  address: string,
  label: string,
): Promise<TimeseriesRow[]> {
  const result = await db.query(
    `
    SELECT DISTINCT ON (component)
      chain_id AS "chainId",
      address,
      label,
      component,
      value,
      series_time AS time
    FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label = $3
    ORDER BY component, series_time DESC
  `,
    [chainId, getAddress(address as `0x${string}`), label],
  )

  return result.rows as TimeseriesRow[]
}
