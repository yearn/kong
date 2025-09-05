import db from '@/app/api/db'
import { compareEvmAddresses, EvmAddressSchema } from 'lib/types'
import { getAddress } from 'viem'
import { z } from 'zod'

const NewYieldSplitterLogSchema = z.object({
  chainId: z.number(),
  address: EvmAddressSchema,
  splitter: EvmAddressSchema,
  vault: EvmAddressSchema,
  want: EvmAddressSchema
})

export type NewYieldSplitterLog = z.infer<typeof NewYieldSplitterLogSchema>

const newYieldSplitterLogs = async (_: object, args: { chainId?: number, address?: string, splitter?: string, vault?: string, want?: string }) => {
  const { chainId, address, splitter, vault, want } = args

  try {
    const result = await db.query(`
    SELECT
      chain_id,
      signature,
      address,
      args
    FROM
      evmlog
    WHERE
      (chain_id = $1 OR $1 IS NULL) AND (address = $2 OR $2 IS NULL)
      AND event_name = 'NewYieldSplitter';`,
    [chainId, address ? getAddress(address) : null])

    const results = NewYieldSplitterLogSchema.array().parse(result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      splitter: row.args.strategy,
      vault: row.args.vault,
      want: row.args.want,
    })))

    const filter = results.filter(result => {
      if (splitter) return compareEvmAddresses(result.splitter, splitter)
      if (vault) return compareEvmAddresses(result.vault, vault)
      if (want) return compareEvmAddresses(result.want, want)
      return true
    })

    return filter

  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default newYieldSplitterLogs
