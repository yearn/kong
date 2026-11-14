import db from '@/app/api/db'
import { mergeSnapshotSql, pickKeysSql, VAULT_UNSERVED_KEYS } from '@/lib/mergeSnapshot'
import { requestedFields } from '@/lib/requestedFields'
import { buildVaultFilters, VaultFilterArgs } from '@/lib/vaultFilters'
import { DefaultRiskScore } from 'lib/types'
import { GraphQLResolveInfo } from 'graphql'

const tvl = 'COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0)'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

type VaultsArgs = VaultFilterArgs & { limit?: number | null, offset?: number | null }

export default async (_: object, args: VaultsArgs, _context?: unknown, info?: GraphQLResolveInfo) => {
  try {
    const { where, params } = buildVaultFilters(args)
    params.push(
      Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
      Math.max(args.offset ?? 0, 0)
    )
    const limit = `$${params.length - 1}`
    const offset = `$${params.length}`
    let merged = mergeSnapshotSql(VAULT_UNSERVED_KEYS)
    if (info) {
      params.push(requestedFields(info))
      merged = pickKeysSql(merged, `$${params.length}`)
    }

    const result = await db.query(`
    SELECT
      thing.chain_id,
      thing.address,
      ${merged} AS merged
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE ${where}
    ORDER BY ${tvl} DESC, thing.chain_id ASC, lower(thing.address) ASC
    LIMIT ${limit} OFFSET ${offset}`,
    params)

    return result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.merged,
      risk: row.merged.risk ?? DefaultRiskScore
    }))
  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}
