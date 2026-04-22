import 'lib/global'

import db from 'ingest/db'

export type TempRow = {
  chain_id: number
  address: string
  label: string
  component: string
  value: number
  block_number: string | bigint
  block_time: Date
  series_time: Date
}

export async function resetTempTable(name: string): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${name} (
      chain_id     integer NOT NULL,
      address      text NOT NULL,
      label        text NOT NULL,
      component    text NOT NULL,
      value        numeric,
      block_number bigint NOT NULL,
      block_time   timestamptz NOT NULL,
      series_time  timestamptz NOT NULL,
      PRIMARY KEY  (chain_id, address, label, component, series_time)
    )
  `)
  await db.query(`TRUNCATE TABLE ${name}`)
}

export async function insertTempBatch(name: string, rows: TempRow[]): Promise<void> {
  if (rows.length === 0) return

  const values: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let idx = 1

  for (const row of rows) {
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
    params.push(
      row.chain_id, row.address, row.label, row.component, row.value,
      typeof row.block_number === 'bigint' ? row.block_number.toString() : row.block_number,
      row.block_time, row.series_time,
    )
    idx += 8
  }

  await db.query(`
    INSERT INTO ${name} (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${values.join(', ')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET value = EXCLUDED.value, block_number = EXCLUDED.block_number, block_time = EXCLUDED.block_time
  `, params)
}
