import db from '@/app/api/db'

const projects = async (_: any, args: { chainId?: number }) => {
  const { chainId } = args

  try {
    const result = await db.query(`
    SELECT 
      thing.chain_id,
      thing.defaults as defaults,
      snapshot.hook as hook,
      snapshot.snapshot as snapshot
    FROM thing
    JOIN snapshot 
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = $1
      AND (thing.chain_id = $2 OR $2 IS NULL)`,
    ['roleManager', chainId])

    return result.rows.map(row => ({
      chainId: row.chain_id,
      ...row.hook?.project,
      roleManagerFactory: row.defaults?.roleManagerFactory,
      governance: row.snapshot?.chad
    }))
  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default projects
