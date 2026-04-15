import 'lib/global'

import { writeFileSync } from 'fs'
import { V3_ORACLE_ABI } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/abi'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import { join } from 'path'
import { BaseError, ContractFunctionRevertedError } from 'viem'

/**
 * Probe script: identifies which vaults with snapshot oracle apr=0
 * actually revert when calling getStrategyApr on-chain.
 *
 * Vaults that revert are "faulty" — they can't return an APR from the oracle.
 * Writes faulty vaults to probe-results.json for compute.ts --from-probe.
 */

const RESULTS_FILE = join(__dirname, 'probe-results.json')
const CONCURRENCY = 10

async function getAffectedVaults() {
  const result = await db.query(`
      SELECT s.chain_id, s.address
      FROM snapshot s
      JOIN thing t ON s.chain_id = t.chain_id AND s.address = t.address
      WHERE s.hook #>> '{performance,oracle,apr}' IS NOT NULL
        AND (s.hook #>> '{performance,oracle,apr}')::numeric = 0
        AND t.label = 'vault'
        AND COALESCE((t.defaults->>'v3')::boolean, false)
        AND COALESCE((t.defaults->>'yearn')::boolean, false)
  `)

  const vaults = result.rows.map((row: Record<string, unknown>) => ({
    chainId: row.chain_id as number,
    address: row.address as string,
  }))

  const faulty: { chainId: number; address: string }[] = []
  const genuine: { chainId: number; address: string }[] = []

  for (let i = 0; i < vaults.length; i += CONCURRENCY) {
    const batch = vaults.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(batch.map(async (vault) => {
      const oracleConfig = getOracleConfig(vault.chainId)
      if (!oracleConfig) return { vault, kind: 'skip' as const }

      try {
        await rpcs.next(vault.chainId).readContract({
          abi: V3_ORACLE_ABI,
          address: oracleConfig.address,
          functionName: 'getStrategyApr',
          args: [vault.address as `0x${string}`, 0n],
        })
        return { vault, kind: 'genuine' as const }
      } catch (error) {
        if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError)) {
          return { vault, kind: 'faulty' as const }
        }
        console.warn(`  unexpected error for ${vault.chainId}:${vault.address}`, error)
        return { vault, kind: 'skip' as const }
      }
    }))

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.kind === 'faulty') faulty.push(result.value.vault)
        else if (result.value.kind === 'genuine') genuine.push(result.value.vault)
      } else {
        console.error('  probe error:', result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }

    process.stdout.write(`\r  probed ${Math.min(i + CONCURRENCY, vaults.length)}/${vaults.length}`)
  }

  if (vaults.length > 0) console.log()

  return { vaults, faulty, genuine }
}

async function main() {
  const startTime = Date.now()

  await rpcs.up()

  const { vaults, faulty, genuine } = await getAffectedVaults()
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`\nChecked ${vaults.length} vaults with snapshot oracle apr=0`)

  console.log('\n=== Faulty (getStrategyApr reverts) ===')
  if (faulty.length === 0) {
    console.log('  none found')
  } else {
    for (const v of faulty) {
      console.log(`  ${v.chainId}:${v.address}`)
    }
  }

  console.log('\n=== Genuine zeros (getStrategyApr returns successfully) ===')
  if (genuine.length === 0) {
    console.log('  none')
  } else {
    for (const v of genuine) {
      console.log(`  ${v.chainId}:${v.address}`)
    }
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(faulty, null, 2))
  console.log(`\nWrote ${faulty.length} faulty vaults to ${RESULTS_FILE}`)

  console.log('\n=== Summary ===')
  console.log(`Total checked:  ${vaults.length}`)
  console.log(`Faulty:         ${faulty.length}`)
  console.log(`Genuine zeros:  ${genuine.length}`)
  console.log(`Duration:       ${duration}s`)

  if (faulty.length > 0) {
    console.log('\nNext step:')
    console.log('  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts --from-probe')
  }

  await rpcs.down()
  await mq.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
