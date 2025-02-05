import { z } from 'zod'
import db from '@/app/api/db'
import { zhexstring } from 'lib/types'
import { snakeToCamelCols } from '@/lib/strings'

const accountRoles = async (_: object, args: { chainId?: number, account: `0x${string}` }) => {
  const { chainId, account } = args
  try {

    const result = await db.query(`
    WITH expanded_roles AS (
      SELECT
        s.chain_id,
        s.address,
        jsonb_array_elements(s.hook->'roles') AS role
      FROM snapshot s
    )
    SELECT
      er.chain_id,
      er.address,
      (er.role->>'account') AS account,
      (er.role->>'roleMask') AS role_mask
    FROM expanded_roles er
    WHERE
      (er.chain_id = $1 OR $1 IS NULL)
      AND (er.role->>'account') = $2;`,
    [chainId, account])

    return z.object({
      chainId: z.number(),
      address: zhexstring,
      account: zhexstring,
      roleMask: z.bigint({ coerce: true })
    }).array().parse(snakeToCamelCols(result.rows))

  } catch (error) {
    console.error(error)
    throw new Error('!accountRoles')
  }
}

export default accountRoles
