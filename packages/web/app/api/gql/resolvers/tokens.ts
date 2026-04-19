import db from '@/app/api/db'

const tokens = async (_: object, args: { chainId?: number }) => {
  const { chainId } = args

  try {
    const result = await db.query(`
      SELECT
        (defaults->>'chainId')::int AS "chainId",
        defaults->>'address' AS address,
        defaults->>'name' AS name,
        defaults->>'symbol' AS symbol,
        (defaults->>'decimals')::int AS decimals
      FROM thing
      WHERE label = 'erc20'
        AND ($1::int IS NULL OR (defaults->>'chainId')::int = $1)
      ORDER BY "chainId", name
    `, [chainId ?? null])

    return result.rows

  } catch (error) {
    console.error(error)
    throw new Error('!tokens')
  }
}

export default tokens
