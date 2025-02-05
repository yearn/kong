import db from '@/app/api/db'
import { EvmAddress } from 'lib/types'

const accountant = async (_: object, args: { chainId: number, address: EvmAddress }) => {
  const { chainId, address } = args
  try {

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
    WHERE thing.label = $1
      AND thing.chain_id = $2
      AND thing.address = $3`,
    ['accountant', chainId, address])

    const [first] = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook
    }))

    return first

  } catch (error) {
    console.error(error)
    throw new Error('!accountant')
  }
}

export default accountant
