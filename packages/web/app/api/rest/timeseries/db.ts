import type { Pool } from 'pg'
import db from '../../db'
import { getAddress } from 'viem'
import { trancheControllerLabels, trancheLabels } from './labels'

export type VaultRow = {
  chainId: number
  address: string
}

export type TimeseriesRow = {
  component: string
  value: number
  time: bigint
}

export async function getVaults(pool: Pool = db): Promise<VaultRow[]> {
  const result = await pool.query(`
    SELECT DISTINCT
      chain_id AS "chainId",
      address
    FROM thing
    WHERE label = 'vault'
    ORDER BY chain_id, address
  `)

  return result.rows as VaultRow[]
}

export async function getTranches(pool: Pool = db): Promise<VaultRow[]> {
  const result = await pool.query(`
    SELECT DISTINCT
      chain_id AS "chainId",
      address
    FROM thing
    WHERE label = 'tranche'
    ORDER BY chain_id, address
  `)

  return result.rows as VaultRow[]
}

/**
 * Addresses that carry controller-scoped series (`tranche-system`). A controller
 * is not a vault, so it never shows up in getVaults() — it has a thing of its own
 * under the `trancheController` label.
 */
export async function getTrancheControllers(pool: Pool = db): Promise<VaultRow[]> {
  const result = await pool.query(`
    SELECT
      chain_id AS "chainId",
      address
    FROM thing
    WHERE label = 'trancheController'
    ORDER BY chain_id, address
  `)

  return result.rows as VaultRow[]
}

// Narrower scopes get their own pass rather than a query per vault: tranche
// series only exist at tranches, and a controller isn't a vault at all.
export async function getScopedTimeseriesPairs(
  read: (chainId: number, address: string, label: string, pool: Pool) => Promise<TimeseriesRow[]>,
  key: (label: string, chainId: number, addressLower: string) => string,
  pool: Pool = db,
): Promise<Array<[string, string]>> {
  const scoped = [
    { addresses: await getTranches(pool), labels: trancheLabels },
    { addresses: await getTrancheControllers(pool), labels: trancheControllerLabels },
  ]

  const pairs: Array<[string, string]> = []

  for (const { addresses, labels } of scoped) {
    for (const { chainId, address } of addresses) {
      for (const { label } of labels) {
        const rows = await read(chainId, address, label, pool)

        pairs.push([
          key(label, chainId, address.toLowerCase()),
          JSON.stringify({
            value: rows.map(row => ({
              time: Number(row.time),
              component: row.component,
              value: row.value,
            })),
          }),
        ])
      }
    }
  }

  return pairs
}

export async function getFullTimeseries(
  chainId: number,
  address: string,
  label: string,
  pool: Pool = db,
): Promise<TimeseriesRow[]> {
  const result = await pool.query(
    `
    SELECT
      component,
      COALESCE(AVG(NULLIF(value, 0)), 0) AS value,
      time_bucket('1 day'::interval, series_time) AS time
    FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label = $3
    GROUP BY component, time
    -- all-null bucket = ingest gap (price service outage): must read as missing, not zero
    HAVING COUNT(value) > 0
    ORDER BY time ASC
  `,
    [chainId, getAddress(address as `0x${string}`), label],
  )

  return result.rows as TimeseriesRow[]
}

export async function getRecentTimeseries(
  chainId: number,
  address: string,
  label: string,
  pool: Pool = db,
): Promise<TimeseriesRow[]> {
  const result = await pool.query(
    `
    SELECT
      component,
      COALESCE(AVG(NULLIF(value, 0)), 0) AS value,
      time_bucket('1 day'::interval, series_time) AS time
    FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label = $3
      AND series_time >= date_trunc('day', NOW()) - INTERVAL '2 days'
    GROUP BY component, time
    HAVING COUNT(value) > 0
    ORDER BY time ASC
  `,
    [chainId, getAddress(address as `0x${string}`), label],
  )

  return result.rows as TimeseriesRow[]
}
