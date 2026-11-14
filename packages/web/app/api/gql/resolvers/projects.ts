import db from '@/app/api/db'

const projects = async (_: object, args: { chainId?: number }) => {
  const { chainId } = args

  try {
    const result = await db.query(`
    SELECT
      thing.chain_id,
      snapshot.hook->'project' AS project,
      thing.defaults->>'roleManagerFactory' AS role_manager_factory,
      snapshot.snapshot->>'chad' AS governance
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = $1
      AND (thing.chain_id = $2 OR $2 IS NULL)`,
    ['roleManager', chainId])

    return result.rows.map(row => ({
      chainId: row.chain_id,
      ...row.project,
      roleManagerFactory: row.role_manager_factory,
      governance: row.governance
    }))
  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default projects
