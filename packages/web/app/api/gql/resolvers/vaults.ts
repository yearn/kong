import db from '@/app/api/db'
import { mergeSnapshotSql, VAULT_UNSERVED_KEYS } from '@/lib/mergeSnapshot'
import { buildVaultFilters, VaultFilterArgs } from '@/lib/vaultFilters'
import { DefaultRiskScore } from 'lib/types'

const tvl = 'COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0)'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

type VaultsArgs = VaultFilterArgs & { limit?: number, after?: string | null }

const inflight = new Map<string, Promise<unknown[]>>()

type VaultCursor = { address: string, chainId?: number }

/**
 * Cursors are chainId:address when paging across all chains. Keep accepting
 * the historical address-only form for callers that scope the query to one
 * chain (and for backwards compatibility).
 */
export const parseVaultCursor = (after?: string | null): VaultCursor | undefined => {
  if (after == null || after === '') return undefined
  const separator = after.indexOf(':')
  if (separator > 0 && /^\d+$/.test(after.slice(0, separator))) {
    const chainId = Number(after.slice(0, separator))
    if (Number.isSafeInteger(chainId)) {
      return { chainId, address: after.slice(separator + 1) }
    }
  }
  return { address: after }
}

export const formatVaultCursor = (chainId: number, address: string) => `${chainId}:${address}`

const vaults = (_: object, args: VaultsArgs) => {
  const key = JSON.stringify(args)
  const hit = inflight.get(key)
  if (hit) return hit
  const p = query(args).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const query = async (args: VaultsArgs) => {
  try {
    const { where, params } = buildVaultFilters(args)
    const cursor = parseVaultCursor(args.after)
    params.push(
      cursor?.address ?? null,
      args.chainId ?? null,
      Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    )
    const after = `$${params.length - 2}`
    const chain = `$${params.length - 1}`
    const limit = `$${params.length}`
    const cursorChainFilter = cursor?.chainId === undefined
      ? ''
      : `\n        AND thing.chain_id = ${cursor.chainId}`

    const result = await db.query(`
    WITH cursor AS (
      SELECT ${tvl} AS tvl, lower(thing.address) AS address, thing.chain_id
      FROM thing
      JOIN snapshot
        ON thing.chain_id = snapshot.chain_id
        AND thing.address = snapshot.address
      WHERE thing.label = $1
        AND (${chain}::int IS NULL OR thing.chain_id = ${chain}::int)
        AND lower(thing.address) = lower(${after})
        ${cursorChainFilter}
      ORDER BY ${tvl} DESC, lower(thing.address) ASC, thing.chain_id ASC
      LIMIT 1
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
      AND (${after}::text IS NULL
        OR ${tvl} < (SELECT tvl FROM cursor)
        OR (${tvl} = (SELECT tvl FROM cursor)
          AND (lower(thing.address) > (SELECT address FROM cursor)
            OR (lower(thing.address) = (SELECT address FROM cursor)
              AND thing.chain_id > (SELECT chain_id FROM cursor)))))
    ORDER BY ${tvl} DESC, lower(thing.address) ASC, thing.chain_id ASC
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
