import { mq } from 'lib'
import { Queue } from 'bullmq'
import { Pool } from 'pg'
import { Processor } from 'lib/processor'
import { Price, PriceSchema } from 'lib/types'
import batchx from 'lib/batchx'
import { getAddress } from 'viem'
import { usePriceService } from '../prices'

const db = new Pool({
  host: process.env.WAVEYDB_HOST,
  port: (process.env.WAVEYDB_PORT || 5432) as number,
  ssl: {
    rejectUnauthorized: false
  },
  database: process.env.WAVEYDB_NAME,
  user: process.env.WAVEYDB_USER,
  password: process.env.WAVEYDB_PASSWORD,
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 60_000
})

export class WaveyDbExtractor implements Processor {
  queues: { [key: string]: Queue } = {}

  async up() {}

  async down() {}

  async extract() {
    await this.extractPrices()
  }

  async extractPrices() {
    // Service mode decommissions the price table; skip these writes entirely.
    if (usePriceService()) return

    const result = await db.query(`
      SELECT 
        chain_id as "chainId",
        want_token as "address",
        block as "blockNumber",
        timestamp as "blockTime",
        want_price_at_block as "priceUsd"
      FROM
        reports;
    `)

    const prices = result.rows.map(row => PriceSchema.parse({
      ...row,
      address: getAddress(row.address),
      priceSource: 'yprice via waveydb'
    }))

    await batchx(prices, 100, async (batch: Price[]) => {
      await mq.add(mq.job.load.price, { batch })
    })
  }
}
