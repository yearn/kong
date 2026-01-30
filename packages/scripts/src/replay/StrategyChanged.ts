import 'lib/global'
import { z } from 'zod'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import { zhexstring } from 'lib/types'
import db from 'ingest/db'
import processStrategyChanged from 'ingest/abis/yearn/3/vault/event/StrategyChanged/hook'

const VaultSchema = z.object({
  chainId: z.number(),
  address: zhexstring
})

const EventSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  blockNumber: z.bigint({ coerce: true }),
  args: z.object({
    strategy: zhexstring,
    change_type: z.number({ coerce: true })
  })
})

type Vault = z.infer<typeof VaultSchema>

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  )
}

async function processVault(vault: Vault, index: number, total: number): Promise<{ processed: number, errors: number }> {
  const events = await db.query(`
    SELECT
      chain_id as "chainId",
      address,
      block_number as "blockNumber",
      args
    FROM evmlog
    WHERE chain_id = $1
      AND address = $2
      AND event_name = 'StrategyChanged'
    ORDER BY block_number ASC, log_index ASC
  `, [vault.chainId, vault.address])

  const parsedEvents = EventSchema.array().parse(events.rows)
  let processed = 0
  let errors = 0

  for (const event of parsedEvents) {
    try {
      await processStrategyChanged(vault.chainId, vault.address, {
        blockNumber: event.blockNumber,
        args: event.args
      })
      processed++
    } catch {
      errors++
    }
  }

  if (processed > 0 || errors > 0) {
    const errorSuffix = errors > 0 ? ` (${errors} errors)` : ''
    console.log(`✓ ${index}/${total} ${vault.chainId} ${vault.address} (${processed} events)${errorSuffix}`)
  }
  return { processed, errors }
}

async function replayStrategyChanged() {
  const startTime = Date.now()

  const vaults = await db.query(`
    SELECT chain_id as "chainId", address
    FROM thing
    WHERE label = 'vault' AND defaults->>'v3' = 'true'
  `)

  const parsedVaults = VaultSchema.array().parse(vaults.rows)
  const total = parsedVaults.length
  console.log('📦', 'vaults', total)

  const batches = chunk(parsedVaults, 10)
  let totalEvents = 0
  let totalErrors = 0

  for (const [batchIndex, batch] of batches.entries()) {
    const results = await Promise.all(
      batch.map((vault, i) => processVault(vault, batchIndex * 10 + i + 1, total))
    )
    totalEvents += results.reduce((a, b) => a + b.processed, 0)
    totalErrors += results.reduce((a, b) => a + b.errors, 0)
    console.log(`📦 batch ${batchIndex + 1}/${batches.length} complete`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const errorSuffix = totalErrors > 0 ? ` (${totalErrors} errors)` : ''
  console.log(`✅ replayed ${totalEvents} events across ${total} vaults in ${duration}s${errorSuffix}`)
  return totalEvents
}

async function main() {
  console.log('db up')
  await rpcs.up()
  console.log('rpcs up')

  try {
    await replayStrategyChanged()

  } catch (error) {
    console.error('🤬', error)

  } finally {
    await mq.down()
    await rpcs.down()
    console.log('rpcs down')
    await db.end()
    console.log('db down')
  }
}

main()
