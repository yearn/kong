import 'lib/global'
import { z } from 'zod'
import { Pool, types as pgTypes } from 'pg'
import { compare } from 'compare-versions'
import { HarvestSchema, computeApr } from 'ingest/abis/yearn/2/strategy/event/hook'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'

const HarvestWithHookSchema = HarvestSchema.extend({
  hook: z.any(),
  transactionHash: z.string()
})

// Convert numeric (OID 1700) to float
pgTypes.setTypeParser(1700, 'text', parseFloat)

// Convert timestamptz (OID 1184) to seconds
pgTypes.setTypeParser(1184, (stringValue) => {
  return BigInt(Math.floor(Date.parse(stringValue) / 1000))
})

function getDb() {
  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: (process.env.POSTGRES_PORT ?? 5432) as number,
    ssl: (process.env.POSTGRES_SSL ?? false)
      ? (process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED ?? true)
        ? true
        : { rejectUnauthorized: false }
      : false,
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  })
}

async function replayHarvestsWithBadAprs(db: Pool) {
  const result: { chainId: number, address: string, blockNumber: bigint }[] = []
  const strategies = await db.query(`
    select
      snapshot.chain_id as "chainId",
      snapshot.address as "address",
      replace(snapshot->>'apiVersion', '.Edited', '') as "apiVersion",
      hook->'lastReportDetail' as "lastReportDetail"
    from snapshot
    join thing on snapshot.chain_id = thing.chain_id and snapshot.address = thing.address
    where thing.label = 'strategy'
  `)

  for (const [index, strategy] of strategies.rows.entries()) {
    const v3 = compare(strategy.apiVersion, '3.0.0', '>=')
    if (v3) { continue }

    console.log('🔍', strategy.chainId, strategy.address, index + 1, '/', strategies.rows.length)

    const harvestdata = await db.query(`
      select chain_id as "chainId", address, args, hook, block_number as "blockNumber", block_time as "blockTime", transaction_hash as "transactionHash"
      from evmlog
      where
        chain_id = ${strategy.chainId}
        and address = '${strategy.address}'
        and event_name = 'Harvested'
      order by block_number desc, log_index desc
    `)

    const harvests = HarvestWithHookSchema.array().parse(harvestdata.rows)
    if (harvests.length < 2) { continue }

    for (const [index, harvest] of harvests.entries()) {
      if (index > harvests.length - 2) { continue }

      try {
        const latestApr = await computeApr(harvests[index], harvests[index + 1])

        if (latestApr.gross !== (harvests[index].hook.apr.gross ?? 0)) {
          console.log(
            harvest.transactionHash, '😱',
            'latestApr.gross', latestApr.gross,
            'harvests[index].hook.apr.gross ?? 0', harvests[index].hook.apr.gross ?? 0,
            'block', harvest.blockNumber,
            'replay', result.length + 1
          )

          result.push({
            chainId: strategy.chainId,
            address: strategy.address,
            blockNumber: harvest.blockNumber
          })

          console.log('mq.add(mq.job.extract.evmlog)', strategy.chainId, strategy.address, harvest.blockNumber)
          await mq.add(mq.job.extract.evmlog, {
            abiPath: 'yearn/2/strategy',
            chainId: strategy.chainId,
            address: strategy.address,
            from: harvest.blockNumber,
            to: harvest.blockNumber,
            replay: false
          })

        } else {
          console.log(harvest.transactionHash, '👍', 'aprs =')
        }

      } catch {
        console.error('🤬🤬🤬🤬🤬', harvest.chainId, harvest.address, harvest.blockNumber)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return result
}

async function main() {
  const db = getDb()
  console.log('db up')
  await rpcs.up()
  console.log('rpcs up')

  try {
    const harvests = await replayHarvestsWithBadAprs(db)
    console.log('harvests', harvests.length)

  } catch (error) {
    console.error('🤬🤬🤬🤬🤬')
    console.error(error)
    console.error('🤬🤬🤬🤬🤬')

  } finally {
    await mq.down()
    await rpcs.down()
    console.log('rpcs down')
    await db.end()
    console.log('db down')

  }
}

main()
