import db from '@/app/api/db'
import { snakeToCamelCols } from '@/lib/strings'

const allocator = async (_: object, args: { chainId: number, vault: `0x${string}` }) => {
  const { chainId, vault } = args
  try {

    const result = await db.query(`
    SELECT
      chain_id,
      address,
      args->>'vault' as vault
    FROM
      evmlog
    WHERE
      chain_id = $1
      AND event_name = 'NewDebtAllocator'
      AND args->>'vault' = $2`,
    [chainId, vault])

    return snakeToCamelCols(result.rows)[0]

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default allocator
