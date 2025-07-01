import db from '@/app/api/db'
import { snakeToCamelObject } from '@/lib/strings'
import { compareEvmAddresses, Erc20Schema, EvmAddressSchema } from 'lib/types'
import { z } from 'zod'

const VestingEscrowCreatedLogSchema = z.object({
  chainId: z.number(),
  funder: EvmAddressSchema,
  token: Erc20Schema,
  recipient: EvmAddressSchema,
  escrow: EvmAddressSchema,
  amount: z.bigint({ coerce: true }),
  vestingStart: z.bigint({ coerce: true }),
  vestingDuration: z.bigint({ coerce: true }),
  cliffLength: z.bigint({ coerce: true }),
  openClaim: z.boolean()
})

export type VestingEscrowCreatedLogSchema = z.infer<typeof VestingEscrowCreatedLogSchema>

const vestingEscrowCreatedLogs = async (_: object, args: { recipient?: string }) => {
  const { recipient } = args

  try {
    const result = await db.query(`
    SELECT
      chain_id,
      args,
      hook
    FROM
      evmlog
    WHERE
      chain_id = 1 AND event_name = 'VestingEscrowCreated';`,
    [])

    console.log(result.rows)

    const results = VestingEscrowCreatedLogSchema.array().parse(result.rows.map(row => ({
      chainId: row.chain_id,
      ...snakeToCamelObject(row.args),
      token: row.hook.token
    })))

    const filter = results.filter(result => {
      if (recipient) return compareEvmAddresses(result.recipient, recipient)
      return true
    })

    const sort = filter.sort((a, b) => {
      return Number(b.vestingStart) - Number(a.vestingStart)
    })

    return sort

  } catch (error) {
    console.error(error)
    throw new Error('!things')
  }
}

export default vestingEscrowCreatedLogs
