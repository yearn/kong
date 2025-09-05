import db from '@/app/api/db'
import { getAddress } from 'viem'

const strategy = async (_: object, args: { chainId: number, address: `0x${string}` }) => {
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
    WHERE thing.label = $1 AND thing.chain_id = $2 AND thing.address = $3
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC`,
    ['strategy', chainId, getAddress(address)])

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
    throw new Error('!strategies')
  }
}

export default strategy
