import db from '@/app/api/db'

const accountStrategies = async (_: object, args: { chainId?: number, account: `0x${string}` }) => {
  const { chainId, account } = args
  try {

    const rolesFilter = JSON.stringify({ roles: [{ account }] })
    const result = await db.query(`
    WITH strategies AS (
      SELECT DISTINCT
        thing.chain_id,
        jsonb_array_elements_text(snapshot.hook->'strategies') AS address
      FROM thing
      JOIN snapshot
        ON thing.chain_id = snapshot.chain_id
        AND thing.address = snapshot.address
      WHERE
        thing.label = $1
        AND (thing.chain_id = $2 OR $2 IS NULL)
        AND snapshot.hook @> $3::jsonb
    )

    SELECT
      thing.chain_id,
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
    FROM thing
    JOIN strategies
      ON thing.chain_id = strategies.chain_id
      AND thing.address = strategies.address
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = $4 AND (thing.chain_id = $2 OR $2 IS NULL);`,
    ['vault', chainId, rolesFilter, 'strategy'])

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

export default accountStrategies
