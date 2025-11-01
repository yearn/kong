/**
 * Rollback evmlog_strides to commit 5a88a2a (2025-10-25 18:12:11 -0400)
 *
 * This script rolls back the indexed block ranges to a specific point in time.
 * Block numbers were obtained from DeFiLlama API for the target timestamp: 1761430331
 *
 */

import 'lib/global'
import { Pool } from 'pg'
import { rollback } from 'lib/strider'

// Target blocks for each chain at the rollback timestamp
const ROLLBACK_TARGETS = {
  1: 23657375n,      // mainnet
  10: 142915777n,    // optimism
  100: 42812735n,    // gnosis
  137: 78162752n,    // polygon
  146: 51872687n,    // sonic
  250: 117399886n,   // fantom
  8453: 37320492n,   // base
  42161: 393385831n, // arbitrum
  80094: 12260847n,  // bera
} as const

type ChainId = keyof typeof ROLLBACK_TARGETS

const CHAIN_NAMES: Record<ChainId, string> = {
  1: 'mainnet',
  10: 'optimism',
  100: 'gnosis',
  137: 'polygon',
  146: 'sonic',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  80094: 'bera',
}

interface StrideRow {
  chain_id: number
  address: string
  strides: string
}

interface Stride {
  from: bigint
  to: bigint
}

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: (process.env.POSTGRES_PORT ?? 5432) as number,
    ssl: (process.env.POSTGRES_SSL ?? false)
      ? (process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED ?? true)
        ? true
        : { rejectUnauthorized: false }
      : false,
    database: process.env.POSTGRES_DATABASE ?? 'user',
    user: process.env.POSTGRES_USER ?? 'user',
    password: process.env.POSTGRES_PASSWORD ?? 'password',
  })

  console.log('🔍 Checking which addresses will be affected...\n')

  // Compute affected addresses for all chains
  const affectedByChain = new Map<ChainId, Array<{ address: string, strides: Stride[], rolledback: Stride[] }>>()

  for (const [chainId, targetBlock] of Object.entries(ROLLBACK_TARGETS)) {
    const chain = Number(chainId) as ChainId
    const result = await pool.query<StrideRow>(
      'SELECT chain_id, address, strides FROM evmlog_strides WHERE chain_id = $1',
      [chain]
    )

    const affected: Array<{ address: string, strides: Stride[], rolledback: Stride[] }> = []

    for (const row of result.rows) {
      const strides: Stride[] = JSON.parse(row.strides)
      const rolledback = rollback(strides, targetBlock)

      // Only include if rollback changes something
      if (JSON.stringify(strides) !== JSON.stringify(rolledback)) {
        affected.push({ address: row.address, strides, rolledback })
      }
    }

    affectedByChain.set(chain, affected)

    if (affected.length > 0) {
      console.log(`📌 ${CHAIN_NAMES[chain]} (${chain}): ${affected.length} addresses will be rolled back to block ${targetBlock}`)
      console.log(`   First few: ${affected.slice(0, 3).map(a => a.address).join(', ')}${affected.length > 3 ? '...' : ''}`)
    } else {
      console.log(`✅ ${CHAIN_NAMES[chain]} (${chain}): No addresses need rollback`)
    }
  }

  console.log('\n❓ Do you want to proceed? (Ctrl+C to cancel, Enter to continue)')
  await new Promise(resolve => {
    process.stdin.once('data', resolve)
  })

  console.log('\n🔄 Starting rollback...\n')

  let totalUpdated = 0

  for (const [chainId] of Object.entries(ROLLBACK_TARGETS)) {
    const chain = Number(chainId) as ChainId
    const affected = affectedByChain.get(chain) ?? []

    if (affected.length === 0) continue

    for (const { address, strides, rolledback } of affected) {
      const rolledbackStridesJson = rolledback.map(s => ({
        from: s.from.toString(),
        to: s.to.toString()
      }))

      await pool.query(
        'UPDATE evmlog_strides SET strides = $1 WHERE chain_id = $2 AND address = $3',
        [JSON.stringify(rolledbackStridesJson), chain, address]
      )

      console.log(`  ✓ ${CHAIN_NAMES[chain]}: ${address} (${strides.length} → ${rolledback.length} strides)`)
    }

    console.log(`\n✅ ${CHAIN_NAMES[chain]}: Updated ${affected.length} addresses\n`)
    totalUpdated += affected.length
  }

  console.log(`\n🎉 Rollback complete! Updated ${totalUpdated} total addresses.`)

  await pool.end()
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
