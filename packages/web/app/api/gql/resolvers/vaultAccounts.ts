import { z } from 'zod'
import db from '@/app/api/db'
import { zhexstring } from 'lib/types'
import { getAddress } from 'viem'

const vaultAccounts = async (_: object, args: { chainId?: number, vault: `0x${string}` }) => {
  const { chainId, vault } = args
  try {

    const result = await db.query(`
    SELECT
      chain_id AS "chainId",
      address,
      (role_record).account,
      (role_record)."roleMask"
    FROM snapshot,
      jsonb_to_recordset(hook->'roles') AS role_record(account text, "roleMask" text)
    WHERE chain_id = $1 AND address = $2;`,
    [chainId, getAddress(vault)])

    return z.object({
      chainId: z.number(),
      address: zhexstring,
      account: zhexstring,
      roleMask: z.bigint({ coerce: true })
    }).array().parse(result.rows)

  } catch (error) {
    console.error(error)
    throw new Error('!accountRoles')
  }
}

export default vaultAccounts
