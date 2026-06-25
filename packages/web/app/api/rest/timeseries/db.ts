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

export type SeriesPayloadRow = {
  chainId: number
  address: string
  payload: string
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

/**
 * The cache envelope `{"value":[{time,component,value}, …]}` is built entirely
 * in SQL via `jsonb_agg` so each vault's whole daily series travels as a single
 * compact row, instead of one row per daily bucket that re-sends the constant
 * `chain_id`/`address`/`label`/`period` columns every time. That per-row
 * redundancy (a 42-byte `address` repeated on every bucket) was the bulk of the
 * egress these refresh jobs pulled from Neon.
 *
 * `value` is cast to `text` to keep the exact representation node-pg returned
 * before (numeric → string); `time` is epoch seconds as a JSON number, matching
 * the previous `Number(row.time)`.
 */
const SERIES_ELEMENT = `jsonb_build_object(
    'time', b.t, 'component', b.component, 'value', b.value
  )`

const DAILY_BUCKET = `
  o.component,
  extract(epoch FROM time_bucket('1 day'::interval, o.series_time))::bigint AS t,
  COALESCE(AVG(NULLIF(o.value, 0)), 0)::text AS value`

export type LabelPayload = { label: string; payload: string }

/**
 * Full per-vault series for every label, in ONE indexed lookup per vault
 * (`chain_id, address` hits idx_output_chain_address_label_series_time). Kept
 * per-vault — not a cross-vault scan — so it stays short and avoids the
 * read-replica "conflict with recovery" cancellation a large scan triggers,
 * while collapsing the old N×label queries into N. Returns one row per label
 * that has data; labels with none are absent (caller fills the empty envelope).
 */
export async function getFullTimeseries(
  chainId: number,
  address: string,
  labels: string[],
): Promise<LabelPayload[]> {
  const result = await db.query(
    `
    SELECT
      b.label,
      (jsonb_build_object('value', jsonb_agg(${SERIES_ELEMENT} ORDER BY b.t)))::text AS payload
    FROM (
      SELECT o.label, ${DAILY_BUCKET}
      FROM output o
      WHERE o.chain_id = $1
        AND o.address = $2
        AND o.label = ANY($3)
      GROUP BY o.label, o.component, t
    ) b
    GROUP BY b.label
  `,
    [chainId, getAddress(address as `0x${string}`), labels],
  )

  return result.rows as LabelPayload[]
}

/**
 * Recent (last 2 days) series for every vault of a label in one chunk-pruned
 * scan, replacing the previous per-vault query loop. The 2-day filter keeps the
 * scan small (TimescaleDB chunk pruning) so it is safe on the read replica;
 * `EXISTS` restricts to `thing` vault addresses so non-vault output isn't pulled.
 */
export async function getRecentTimeseriesByLabel(
  label: string,
): Promise<SeriesPayloadRow[]> {
  const result = await db.query(
    `
    SELECT
      b.chain_id AS "chainId",
      b.address,
      (jsonb_build_object('value', jsonb_agg(${SERIES_ELEMENT} ORDER BY b.t)))::text AS payload
    FROM (
      SELECT o.chain_id, o.address, ${DAILY_BUCKET}
      FROM output o
      WHERE o.label = $1
        AND o.series_time >= date_trunc('day', NOW()) - INTERVAL '2 days'
        AND EXISTS (
          SELECT 1 FROM thing th
          WHERE th.label = 'vault'
            AND th.chain_id = o.chain_id
            AND th.address = o.address
        )
      GROUP BY o.chain_id, o.address, o.component, t
    ) b
    GROUP BY b.chain_id, b.address
  `,
    [label],
  )

  return result.rows as SeriesPayloadRow[]
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
