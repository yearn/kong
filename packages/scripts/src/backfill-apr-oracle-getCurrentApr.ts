import 'lib/global'

import { computeApy, computeNetApr, extractFees__v3 } from 'ingest/abis/yearn/lib/apy'
import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { V3_ORACLE_ABI } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/abi'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import db from 'ingest/db'
import { upsertBatchOutput } from 'ingest/load'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import { getBlock } from 'lib/blocks'
import type { Output } from 'lib/types'
import { getAddress } from 'viem'

/**
 * Backfill apr-oracle outputs for vaults where `getStrategyApr(vaultAddress)` returned 0
 * but `getCurrentApr(vaultAddress)` returns a real weighted-average APR.
 *
 * The old hook called `getStrategyApr` which only works for addresses with a registered
 * strategy oracle. Pure vaults (not tokenized strategies) got 0. This script retroactively
 * fixes those by calling `getCurrentApr` and upserting corrected outputs.
 */

type Args = {
  apply: boolean
  chainId?: number
  address?: `0x${string}`
}

const WRITE_BATCH_SIZE = 100
const CONCURRENCY = 5

function parseArgs(argv: string[]): Args {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr.ts [--apply] [--chain-id 1] [--address 0x...]

Finds vaults whose latest apr-oracle output has apr=0 and re-queries the
oracle contract using getCurrentApr to get the correct weighted-average APR.

defaults:
  dry-run unless --apply is provided`)
    process.exit(0)
  }

  const chainId = getArg('--chain-id')
  const address = getArg('--address')

  return {
    apply: hasArg('--apply'),
    chainId: chainId ? Number(chainId) : undefined,
    address: address ? getAddress(address as `0x${string}`) : undefined,
  }
}

type AffectedVault = {
  chainId: number
  address: `0x${string}`
  blockNumber: bigint
  blockTime: bigint
}

async function findAffectedVaults(args: Args): Promise<AffectedVault[]> {
  const values: Array<number | string> = []
  const filters: string[] = []

  if (args.chainId !== undefined) {
    values.push(args.chainId)
    filters.push(`o.chain_id = $${values.length}`)
  }

  if (args.address) {
    values.push(args.address)
    filters.push(`o.address = $${values.length}`)
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

  // Find vaults whose latest apr-oracle output has apr=0,
  // but whose strategies have non-zero oracle APRs (proving the oracle has data)
  const result = await db.query(`
    WITH latest_vault_oracle AS (
      SELECT
        o.chain_id AS "chainId",
        o.address,
        MAX(o.block_number) AS "blockNumber",
        EXTRACT(EPOCH FROM MAX(o.block_time))::bigint AS "blockTime",
        MAX(CASE WHEN o.component = 'apr' THEN o.value END) AS apr
      FROM output o
      JOIN thing t
        ON t.chain_id = o.chain_id
        AND t.address = o.address
        AND t.label = 'vault'
        AND COALESCE((t.defaults->>'v3')::boolean, false)
      WHERE o.label = 'apr-oracle'
        AND o.component = 'apr'
        ${whereClause}
      GROUP BY o.chain_id, o.address
    )
    SELECT "chainId", address, "blockNumber", "blockTime"
    FROM latest_vault_oracle
    WHERE apr = 0 OR apr IS NULL
    ORDER BY "chainId", address
  `, values)

  return result.rows.map(row => ({
    chainId: row.chainId,
    address: getAddress(row.address) as `0x${string}`,
    blockNumber: BigInt(row.blockNumber),
    blockTime: BigInt(row.blockTime),
  }))
}

async function backfill(args: Args) {
  const vaults = await findAffectedVaults(args)
  console.log(`found ${vaults.length} vaults with apr-oracle apr=0`)
  if (vaults.length === 0) return

  const outputs: Output[] = []
  let fixed = 0
  let skipped = 0
  let errored = 0

  for (let i = 0; i < vaults.length; i += CONCURRENCY) {
    const batch = vaults.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async (vault) => {
      const oracleConfig = getOracleConfig(vault.chainId)
      if (!oracleConfig) {
        skipped++
        return
      }

      const block = await getBlock(vault.chainId)

      let apr = 0
      try {
        const rawApr = await rpcs.next(vault.chainId).readContract({
          abi: V3_ORACLE_ABI,
          address: oracleConfig.address,
          functionName: 'getCurrentApr',
          args: [vault.address],
          blockNumber: block.number,
        })
        apr = Number(rawApr) / 1e18
      } catch {
        // getCurrentApr failed, try getStrategyApr as fallback
        try {
          const rawApr = await rpcs.next(vault.chainId).readContract({
            abi: V3_ORACLE_ABI,
            address: oracleConfig.address,
            functionName: 'getStrategyApr',
            args: [vault.address, 0n],
            blockNumber: block.number,
          })
          apr = Number(rawApr) / 1e18
        } catch {
          apr = 0
        }
      }

      if (isNaN(apr) || !isFinite(apr)) apr = 0

      if (apr === 0) {
        skipped++
        console.log(`  skip ${vault.chainId}:${vault.address} (getCurrentApr also returned 0)`)
        return
      }

      const apy = computeApy(apr)

      let fees = { management: 0, performance: 0 }
      try {
        const strategies = await projectStrategies(vault.chainId, vault.address, block.number)
        fees = await extractFees__v3(vault.chainId, vault.address, strategies, block.number)
      } catch (error) {
        console.warn(`  ⚠ fee fetch failed for ${vault.chainId}:${vault.address}:`, error)
      }

      const netApr = computeNetApr(apr, fees)
      const netApy = computeApy(netApr)

      const blockTime = BigInt(block.timestamp)

      const components = [
        { component: 'apr', value: apr },
        { component: 'apy', value: apy },
        { component: 'netApr', value: netApr },
        { component: 'netApy', value: netApy },
      ]

      for (const { component, value } of components) {
        outputs.push({
          chainId: vault.chainId,
          address: vault.address,
          label: 'apr-oracle',
          component,
          value,
          blockNumber: block.number,
          blockTime,
        })
      }

      fixed++
      console.log(`  fix ${vault.chainId}:${vault.address} apr=${apr.toFixed(6)} netApr=${netApr.toFixed(6)}`)
    }))
  }

  console.log(`\nresults: ${fixed} fixed, ${skipped} skipped, ${errored} errored`)
  console.log(`total outputs to write: ${outputs.length}`)

  if (outputs.length === 0) return

  // Write in batches
  const batches: Output[][] = []
  for (let i = 0; i < outputs.length; i += WRITE_BATCH_SIZE) {
    batches.push(outputs.slice(i, i + WRITE_BATCH_SIZE))
  }

  let written = 0
  for (const batch of batches) {
    if (args.apply) {
      await upsertBatchOutput(batch)
    }
    written += batch.length
    console.log(`${args.apply ? 'written' : 'would write'} ${written}/${outputs.length} outputs`)
  }

  console.log(`\n${args.apply ? 'upserted' : 'dry-run'}: ${outputs.length} outputs for ${fixed} vaults`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(args.apply ? 'apply mode' : 'dry-run mode')
  if (args.chainId !== undefined) console.log(`chainId=${args.chainId}`)
  if (args.address) console.log(`address=${args.address}`)
  console.log()

  try {
    await backfill(args)
  } finally {
    await mq.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('backfill-apr-oracle-getCurrentApr', error)
  process.exit(1)
})
