import db from '@/app/api/db'
import { compare } from '@/lib/compare'
import { DefaultRiskScore, EvmAddressSchema, RiskScoreSchema } from 'lib/types'

const vaults = async (_: object, args: {
  chainId?: number,
  apiVersion?: string,
  erc4626?: boolean,
  v3?: boolean,
  yearn?: boolean,
  addresses?: string[],
  vaultType?: number,
  riskLevel?: number,
  unratedOnly?: boolean
}) => {
  const { chainId, apiVersion, erc4626, v3, yearn, addresses: rawAddresses, vaultType, riskLevel, unratedOnly } = args

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
    WHERE thing.label = $1 AND (thing.chain_id = $2 OR $2 IS NULL)
    ORDER BY (snapshot.hook->'tvl'->>'close')::numeric DESC`,
    ['vault', chainId])

    let rows = result.rows.map(row => ({
      chainId: row.chain_id,
      address: row.address,
      ...row.defaults,
      ...row.snapshot,
      ...row.hook,
      risk: row.hook.risk ?? DefaultRiskScore
    }))

    if (rawAddresses !== undefined) {
      const validAddressesLowerCase: string[] = []

      for (const rawAddress of rawAddresses) {
        const address = EvmAddressSchema.safeParse(rawAddress)
        if (address.success) { validAddressesLowerCase.push(address.data.toLowerCase()) }
      }

      rows = rows.filter(row => {
        return validAddressesLowerCase.includes(row.address.toLowerCase())
      })
    }

    if (apiVersion !== undefined) {
      rows = rows.filter(row => {
        return compare(row.apiVersion ?? '0', apiVersion, '>=')
      })
    }

    if (erc4626 !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.erc4626 ?? false) === erc4626
      })
    }

    if (v3 !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.v3 ?? false) === v3
      })
    }

    if (yearn !== undefined) {
      rows = rows.filter(row => {
        return Boolean(row.yearn ?? false) === yearn
      })
    }

    if (vaultType !== undefined) {
      rows = rows.filter(row => {
        return Number(row.vaultType ?? 0) === vaultType
      })
    }

    if (unratedOnly === true) {
      rows = rows.filter(row => {
        return row.risk?.riskLevel === undefined || row.risk?.riskLevel === 0
      })
    } else if (riskLevel !== undefined) {
      rows = rows.filter(row => {
        const rowRiskLevel = row.risk?.riskLevel
        return rowRiskLevel !== undefined && rowRiskLevel > 0 && rowRiskLevel <= riskLevel
      })
    }

    return rows

  } catch (error) {
    console.error(error)
    throw new Error('!vaults')
  }
}

export default vaults
