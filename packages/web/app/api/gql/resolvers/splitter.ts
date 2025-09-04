import db from '@/app/api/db'
import { snakeToCamelObject } from '@/lib/strings'
import { EvmAddressSchema } from 'lib/types'
import { getAddress } from 'viem'
import { z } from 'zod'

const NewSplitterLogSchema = z.object({
  chainId: z.number(),
  address: EvmAddressSchema,
  splitter: EvmAddressSchema,
  manager: EvmAddressSchema,
  managerRecipient: EvmAddressSchema,
  splitee: EvmAddressSchema
})

export type NewSplitterLog = z.infer<typeof NewSplitterLogSchema>

const newSplitterLogs = async (_: object, args: { chainId?: number, address?: string, splitter?: string, manager?: string, managerRecipient?: string }) => {
  const { chainId, address, splitter, manager, managerRecipient } = args

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
      AND event_name = 'NewSplitter';`,
    [chainId, address ? getAddress(address) : null])

    const results = NewSplitterLogSchema.array().parse(result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...snakeToCamelObject(row.args)
    })))

    const filter = results.filter(result => {
      if (splitter) return result.splitter === splitter
      if (manager) return result.manager === manager
      if (managerRecipient) return result.managerRecipient === managerRecipient
      return true
    })

    return filter

  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default newSplitterLogs
