import db from '@/app/api/db'
import { mergeSnapshotSql, VAULT_UNSERVED_KEYS } from '@/lib/mergeSnapshot'
import { getAddress } from 'viem'

const vault = async (_: object, args: { chainId: number, address: `0x${string}` }) => {
  const { chainId, address } = args
  try {

    const result = await db.query(`
    SELECT
      thing.chain_id,
      thing.address,
      ${mergeSnapshotSql(VAULT_UNSERVED_KEYS)} AS merged
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.chain_id = $1
      AND thing.address = $2
      AND thing.label = $3`,
    [chainId, getAddress(address), 'vault'])

    const [first] = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged
    }))

    return first

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default vault
