import db from '@/app/api/db'
import { mergeSnapshotSql, VAULT_UNSERVED_KEYS } from '@/lib/mergeSnapshot'
import { buildVaultFilters, VaultFilterArgs } from '@/lib/vaultFilters'
import { DefaultRiskScore } from 'lib/types'

const tvl = 'COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0)'

type VaultsArgs = VaultFilterArgs & { limit?: number, after?: string }

const inflight = new Map<string, Promise<unknown[]>>()

const vaults = (_: object, args: VaultsArgs) => {
  const key = JSON.stringify(args)
  const hit = inflight.get(key)
  if (hit) return hit
  const p = query(args).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const query = async (args: VaultsArgs) => {
  const { where, params } = buildVaultFilters(args)
  params.push(args.after ?? null, args.limit ?? 100)
  const after = `$${params.length - 1}`
  const limit = `$${params.length}`

  try {
    const result = await db.query(`
    WITH cursor AS (
      SELECT ${tvl} AS tvl, thing.address
      FROM thing
      JOIN snapshot
        ON thing.chain_id = snapshot.chain_id
        AND thing.address = snapshot.address
      WHERE thing.label = $1 AND thing.chain_id = $2 AND thing.address = ${after}
    )
    SELECT
      thing.chain_id,
      thing.address,
      ${mergeSnapshotSql(VAULT_UNSERVED_KEYS)} AS merged
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE ${where}
      AND (${after}::text IS NULL OR (${tvl}, thing.address) < (SELECT tvl, address FROM cursor)
        OR (${tvl} = (SELECT tvl FROM cursor) AND thing.address > (SELECT address FROM cursor)))
    ORDER BY ${tvl} DESC, thing.address ASC
    LIMIT ${limit}`,
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

export default vaults
