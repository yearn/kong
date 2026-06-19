export type EstimatedAprOutputRow = {
  label: string
  address: string
  component: string | null
  value: number | null
}

type EstimatedAprDb = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: EstimatedAprOutputRow[] }>
}

type LatestEstimatedAprRowsOptions = {
  label?: string
  includeAddresses?: string[]
  maxAgeDays?: number
}

export async function getLatestEstimatedAprRows(
  db: EstimatedAprDb,
  chainId: number,
  address: string,
  options: LatestEstimatedAprRowsOptions = {}
): Promise<EstimatedAprOutputRow[]> {
  const query = options.label ? LATEST_ROWS_BY_LABEL_SQL : LATEST_ROWS_BY_ESTIMATED_APR_SQL
  const includeAddresses = options.includeAddresses ?? []
  const maxAgeDays = options.maxAgeDays ?? null
  const params = options.label
    ? [chainId, address, options.label, maxAgeDays, includeAddresses]
    : [chainId, address, maxAgeDays, includeAddresses]
  const result = await db.query(query, params)

  return result.rows
}

// series_time is the `output` hypertable partition column; a floor on it prunes
// chunks. series_time >= block_time always holds, so a floor at the same
// maxAgeDays bound never drops a row the block_time bound keeps.
function latestEstimatedAprRowsSql(
  latestWhere: string,
  includeAddressesParam: string,
  maxAgeParam: string
) {
  return `
    WITH latest AS (
      SELECT o.block_time, o.label
      FROM output o
      WHERE ${latestWhere}
      ORDER BY o.block_time DESC
      LIMIT 1
    )
    SELECT
      label,
      address,
      component,
      value::float8 AS value
    FROM output
    WHERE chain_id = $1
      AND (block_time, label) = (SELECT block_time, label FROM latest)
      AND (${maxAgeParam}::int IS NULL OR series_time > NOW() - (${maxAgeParam}::int * INTERVAL '1 day'))
      AND (address = $2 OR address = ANY(${includeAddressesParam}::text[]))
  `
}

const LATEST_ROWS_BY_LABEL_SQL = latestEstimatedAprRowsSql(`
        o.chain_id = $1
        AND o.address = $2
        AND o.label = $3
        AND ($4::int IS NULL OR o.block_time > NOW() - ($4::int * INTERVAL '1 day'))
        AND ($4::int IS NULL OR o.series_time > NOW() - ($4::int * INTERVAL '1 day'))
`, '$5', '$4')

const LATEST_ROWS_BY_ESTIMATED_APR_SQL = latestEstimatedAprRowsSql(`
        o.chain_id = $1
        AND o.address = $2
        AND o.label LIKE '%-estimated-apr'
        AND ($3::int IS NULL OR o.block_time > NOW() - ($3::int * INTERVAL '1 day'))
        AND ($3::int IS NULL OR o.series_time > NOW() - ($3::int * INTERVAL '1 day'))
        AND NOT EXISTS (
          SELECT 1 FROM output o2
          WHERE o2.chain_id = o.chain_id
            AND o2.address = o.address
            AND o2.label = o.label
            AND o2.block_time = o.block_time
            AND o2.component = 'debtRatio'
            AND ($3::int IS NULL OR o2.series_time > NOW() - ($3::int * INTERVAL '1 day'))
        )
`, '$4', '$3')
