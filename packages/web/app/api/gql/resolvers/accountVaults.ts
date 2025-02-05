import db from '@/app/api/db'

const accountVaults = async (_: object, args: { chainId?: number, account: `0x${string}` }) => {
  const { chainId, account } = args
  try {

    const rolesFilter = JSON.stringify({ roles: [{ account }] })
    const result = await db.query(`
    SELECT
      thing.chain_id,
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE
      thing.label = $1
      AND (thing.chain_id = $2 OR $2 IS NULL)
      AND snapshot.hook @> $3::jsonb
    ORDER BY snapshot.hook->>'tvl' DESC`,
    ['vault', chainId, rolesFilter])

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook
    }))

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default accountVaults
