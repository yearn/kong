import { mergedFieldSql, mergedJsonSql } from '@/lib/mergeSnapshot'
import { EvmAddressSchema } from 'lib/types'

export type VaultFilterArgs = {
  chainId?: number | null,
  apiVersion?: string | null,
  erc4626?: boolean | null,
  v3?: boolean | null,
  yearn?: boolean | null,
  origin?: string | null,
  addresses?: string[] | null,
  vaultType?: number | null,
  riskLevel?: number | null,
  unratedOnly?: boolean | null
}

const field = mergedFieldSql

const bool = (key: string) => `COALESCE(${field(key)}::boolean, false)`

const version = (expr: string) =>
  `(string_to_array(COALESCE(substring(${expr} from '^[a-zA-Z]*(\\d+(\\.\\d+){0,2})'), '0'), '.')::numeric[] || ARRAY[0,0,0])[1:3]`

const riskLevelSql = `(${mergedJsonSql('risk')}->>'riskLevel')`

const isYearn = `(${bool('yearn')} OR ${field('origin')} = 'yearn')`

export function buildVaultFilters(args: VaultFilterArgs): { where: string, params: unknown[] } {
  const { chainId, apiVersion, erc4626, v3, yearn, origin, addresses, vaultType, riskLevel, unratedOnly } = args

  const where = ['thing.label = $1']
  const params: unknown[] = ['vault']
  const add = (clause: (p: string) => string, value: unknown) => {
    params.push(value)
    where.push(clause(`$${params.length}`))
  }

  // GraphQL nullable variables arrive here as an explicit null. Treat that
  // the same as an omitted filter rather than generating `x = NULL`.
  if (chainId != null) add(p => `thing.chain_id = ${p}`, chainId)

  if (addresses != null) {
    const valid = addresses
      .map(a => EvmAddressSchema.safeParse(a))
      .flatMap(r => r.success ? [r.data.toLowerCase()] : [])
    add(p => `lower(thing.address) = ANY(${p})`, valid)
  }

  if (apiVersion != null) add(p => `${version(field('apiVersion'))} >= ${version(p)}`, apiVersion)
  if (erc4626 != null) add(p => `${bool('erc4626')} = ${p}`, erc4626)
  if (v3 != null) add(p => `${bool('v3')} = ${p}`, v3)
  if (yearn === true) where.push(isYearn)
  if (yearn === false) where.push(`(NOT ${bool('yearn')} OR ${field('origin')} IS DISTINCT FROM 'yearn')`)

  if (origin === 'yearn') where.push(isYearn)
  else if (origin != null) add(p => `${field('origin')} = ${p}`, origin)

  if (vaultType != null) add(p => `COALESCE(${field('vaultType')}, '0')::numeric = ${p}`, vaultType)

  if (unratedOnly === true) {
    where.push(`COALESCE(${riskLevelSql}::numeric, 0) = 0`)
  } else if (riskLevel != null) {
    add(p => `${riskLevelSql}::numeric BETWEEN 1 AND ${p}`, riskLevel)
  }

  return { where: where.join('\n      AND '), params }
}
