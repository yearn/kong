import 'lib/global'

import { V3_ORACLE_ABI } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/abi'
import { getOracleConfig } from 'ingest/abis/yearn/3/vault/timeseries/apr-oracle/constants'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { chains, mq } from 'lib'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getAddress } from 'viem'

/**
 * Probe script: identifies which vaults with apr=0 in the output table
 * actually have non-zero APR on-chain (i.e., their stored zeros are faulty).
 *
 * Uses the same getCurrentApr → getStrategyApr fallback logic as the
 * apr-oracle hook. Probes each distinct vault once at the latest block.
 *
 * Writes faulty vaults to probe-results.json for compute.ts --from-probe.
 */

const CONCURRENCY = 10
const RESULTS_FILE = join(__dirname, 'probe-results.json')

function parseArgs(argv: string[]) {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/probe.ts [--chain-id 1]

Probes each distinct vault with apr=0 against the oracle at the latest block.
Reports which vaults return non-zero APR (faulty zeros needing backfill).

Writes faulty vaults to probe-results.json for use with:
  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts --from-probe`)
    process.exit(0)
  }

  const chainId = getArg('--chain-id')

  return {
    chainId: chainId ? Number(chainId) : undefined,
  }
}

type AffectedVault = {
  chainId: number
  address: `0x${string}`
}

const availableChainIds = new Set(chains.map(c => c.id))

async function findAffectedVaults(chainId?: number): Promise<AffectedVault[]> {
  const params: number[] = []
  let chainFilter = ''

  if (chainId !== undefined) {
    params.push(chainId)
    chainFilter = `AND o.chain_id = $${params.length}`
  }

  const result = await db.query(`
    SELECT DISTINCT o.chain_id AS "chainId", o.address
    FROM output o
    JOIN thing t
      ON t.chain_id = o.chain_id
      AND t.address = o.address
      AND t.label = 'vault'
      AND COALESCE((t.defaults->>'v3')::boolean, false)
    WHERE o.label = 'apr-oracle'
      AND o.component = 'apr'
      AND o.value = 0
      ${chainFilter}
    ORDER BY o.chain_id, o.address
  `, params)

  return result.rows.map((row: { chainId: number; address: string }) => ({
    chainId: row.chainId,
    address: getAddress(row.address) as `0x${string}`,
  }))
}

async function readApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
): Promise<{ apr: number; source: 'getCurrentApr' | 'getStrategyApr' | 'none' }> {
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getCurrentApr',
      args: [address],
      blockNumber,
    })
    const apr = Number(rawApr) / 1e18
    if (!isNaN(apr) && isFinite(apr) && apr !== 0) {
      return { apr, source: 'getCurrentApr' }
    }
  } catch {}

  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })
    const apr = Number(rawApr) / 1e18
    if (!isNaN(apr) && isFinite(apr) && apr !== 0) {
      return { apr, source: 'getStrategyApr' }
    }
  } catch {}

  return { apr: 0, source: 'none' }
}

async function getZeroRowCount(chainId: number, address: string): Promise<number> {
  const result = await db.query(`
    SELECT COUNT(*) FROM output
    WHERE chain_id = $1
      AND address = $2
      AND label = 'apr-oracle'
      AND component = 'apr'
      AND value = 0
  `, [chainId, address.toLowerCase()])
  return Number(result.rows[0].count)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startTime = Date.now()

  await rpcs.up()

  if (args.chainId !== undefined) console.log(`filtering to chainId=${args.chainId}`)

  const allVaults = await findAffectedVaults(args.chainId)
  console.log(`found ${allVaults.length} distinct vaults with apr=0 output rows\n`)

  if (allVaults.length === 0) {
    await rpcs.down()
    await mq.down()
    await db.end()
    return
  }

  // Filter out vaults on chains without RPC config
  const skippedChains = new Set<number>()
  const vaults = allVaults.filter(v => {
    if (!availableChainIds.has(v.chainId)) {
      skippedChains.add(v.chainId)
      return false
    }
    if (!getOracleConfig(v.chainId)) {
      skippedChains.add(v.chainId)
      return false
    }
    return true
  })

  if (skippedChains.size > 0) {
    console.log(`  skipping chains without RPC/oracle config: ${[...skippedChains].join(', ')}`)
    console.log(`  filtered to ${vaults.length} vaults\n`)
  }

  // Fetch latest block per available chain
  const chainIds = [...new Set(vaults.map(v => v.chainId))]
  const latestBlocks = new Map<number, bigint>()
  for (const chainId of chainIds) {
    try {
      const block = await rpcs.next(chainId).getBlockNumber()
      latestBlocks.set(chainId, block)
      console.log(`  chain ${chainId}: latest block ${block}`)
    } catch (err) {
      console.log(`  chain ${chainId}: failed to get block number, skipping (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  console.log()

  const faulty: { chainId: number; address: string; apr: number; source: string; zeroRows: number }[] = []
  const genuineZeros: { chainId: number; address: string }[] = []
  let errors = 0

  for (let i = 0; i < vaults.length; i += CONCURRENCY) {
    const batch = vaults.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(batch.map(async (vault) => {
      const blockNumber = latestBlocks.get(vault.chainId)
      if (!blockNumber) return { vault, apr: 0, source: 'none' as const, zeroRows: 0 }

      const oracleConfig = getOracleConfig(vault.chainId)!
      const { apr, source } = await readApr(vault.chainId, vault.address, blockNumber, oracleConfig.address)
      const zeroRows = apr !== 0 ? await getZeroRowCount(vault.chainId, vault.address) : 0
      return { vault, apr, source, zeroRows }
    }))

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { vault, apr, source, zeroRows } = result.value
        if (apr !== 0) {
          faulty.push({
            chainId: vault.chainId,
            address: vault.address,
            apr,
            source,
            zeroRows,
          })
        } else {
          genuineZeros.push({ chainId: vault.chainId, address: vault.address })
        }
      } else {
        errors++
        console.error(`  error:`, result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }

    process.stdout.write(`\r  probed ${Math.min(i + CONCURRENCY, vaults.length)}/${vaults.length}`)
  }

  console.log('\n')

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log('=== Faulty zeros (need backfill via compute.ts) ===')
  if (faulty.length === 0) {
    console.log('  none found')
  } else {
    let totalRows = 0
    for (const v of faulty) {
      console.log(`  ${v.chainId}:${v.address}  apr=${v.apr.toFixed(6)}  source=${v.source}  zeroRows=${v.zeroRows}`)
      totalRows += v.zeroRows
    }
    console.log(`\n  total: ${faulty.length} vaults, ${totalRows} output rows to backfill`)
  }

  console.log('\n=== Genuine zeros (oracle returns 0 at latest block) ===')
  if (genuineZeros.length === 0) {
    console.log('  none')
  } else {
    for (const v of genuineZeros) {
      console.log(`  ${v.chainId}:${v.address}`)
    }
    console.log(`\n  total: ${genuineZeros.length} vaults`)
  }

  // Write faulty vaults to file for compute.ts --from-probe
  const probeResults = faulty.map(v => ({ chainId: v.chainId, address: v.address }))
  writeFileSync(RESULTS_FILE, JSON.stringify(probeResults, null, 2))
  console.log(`\nwrote ${probeResults.length} faulty vaults to ${RESULTS_FILE}`)

  console.log(`\n=== Summary ===`)
  console.log(`Vaults probed:    ${faulty.length + genuineZeros.length + errors}`)
  console.log(`Faulty (apr!=0):  ${faulty.length}`)
  console.log(`Genuine (apr=0):  ${genuineZeros.length}`)
  console.log(`Errors:           ${errors}`)
  console.log(`Duration:         ${duration}s`)

  if (faulty.length > 0) {
    console.log(`\nNext step:`)
    console.log(`  bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts --from-probe`)
  }

  await rpcs.down()
  await mq.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
