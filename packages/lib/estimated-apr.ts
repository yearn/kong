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
  const params: unknown[] = [chainId, address]
  const latestWhere = [
    'o.chain_id = $1',
    'o.address = $2',
  ]

  if (options.label) {
    params.push(options.label)
    latestWhere.push(`o.label = $${params.length}`)
  } else {
    latestWhere.push('o.label LIKE \'%-estimated-apr\'')
    latestWhere.push(`NOT EXISTS (
          SELECT 1 FROM output o2
          WHERE o2.chain_id = o.chain_id
            AND o2.address = o.address
            AND o2.label = o.label
            AND o2.block_time = o.block_time
            AND o2.component = 'debtRatio'
        )`)
  }

  if (options.maxAgeDays != null) {
    params.push(options.maxAgeDays)
    latestWhere.push(`o.block_time > NOW() - ($${params.length}::int * INTERVAL '1 day')`)
  }

  params.push(options.includeAddresses ?? [])
  const includeAddressesParam = `$${params.length}`

  const result = await db.query(`
    WITH latest AS (
      SELECT o.block_time, o.label
      FROM output o
      WHERE ${latestWhere.join('\n        AND ')}
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
      AND (address = $2 OR address = ANY(${includeAddressesParam}::text[]))
  `, params)

  return result.rows
}
