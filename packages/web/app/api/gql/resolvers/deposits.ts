import db from '@/app/api/db'

const deposits = async (_: object, args: { chainId: number, address: string }) => {
  const { chainId, address } = args
  try {
    const result = await db.query(`
    SELECT
      chain_id AS "chainId",
      address AS "vaultAddress",
      args->>'assets' AS amount,
      args->>'shares' AS shares,
      args->>'owner' AS recipient
    FROM
      evmlog
    WHERE
      (chain_id = $1 OR $1 IS NULL) AND (address = $2 OR $2 IS NULL)
      AND event_name = 'Deposit'
    ORDER BY
      chain_id, block_time DESC, log_index DESC
    LIMIT 100;`,
    [chainId, address])

    return result.rows
  } catch (error) {
    console.error(error)
    throw new Error('!deposits')
  }
}

export default deposits