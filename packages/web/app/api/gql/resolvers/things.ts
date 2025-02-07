import db from '@/app/api/db'
import { snakeToCamelCols } from '@/lib/strings'

const things = async (_: object, args: { chainId?: number, labels: string[] }) => {
  const { chainId, labels } = args

  try {
    const result = await db.query(`
    SELECT
      chain_id,
      address,
      label
    FROM
      thing
    WHERE
      (chain_id = $1 OR $1 IS NULL)
      AND label = ANY($2::text[]);`,
    [chainId, labels])

    return snakeToCamelCols(result.rows)

  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default things
