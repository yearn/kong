import { mq } from 'lib'
import { Processor } from 'lib/processor'
import { Worker } from 'bullmq'
import db from '../db'
import { snakeToCamelCols } from 'lib/strings'
import { ApiCalculator } from './apy-calculator'
import { Thing } from 'lib/types'

export default class Forward implements Processor {
  worker: Worker | undefined

  handlers: Record<string, (data: any) => Promise<any>> = {
    [mq.job.forward.fApy.name]: async data => {
      this.handleFApy(data)
    },
    [mq.job.forward.curve.name]: async data => {
      this.handleCurve(data)
    },
    [mq.job.forward.v2.name]: async data => {
      this.handleV2(data)
    }
  }

  async up() {
    this.worker = mq.worker(mq.q.forward, async job => {
      const label = `🔄 ${job.name} ${job.id}`
      console.time(label)
      await this.handlers[job.name](job.data)
      console.timeEnd(label)
    })
  }

  async down() {
  }

  async handleFApy() {
    const curve = await this.fetchCurve()
    const v2 = await this.fetchYV2()
    await mq.add(mq.job.forward.curve, curve)
    await mq.add(mq.job.forward.v2, v2)
  }

  async handleCurve(data: Thing[] ) {
    for await (const vault of data) {
      const forward = await ApiCalculator.computeCurveLikeForwardAPY(
        vault,
        vault.defaults.strategies,
        vault.defaults.gauges,
        vault.defaults.pools,
        vault.defaults.subgraphData,
        vault.defaults.fraxPools
      )
      console.info(forward)
    }
  }

  async handleV2(data: any) {
    console.info(data)
  }

  async fetchCurve() {
    const client = await db.connect()
    try {
      const result = await client.query('SELECT * FROM thing where label LIKE 1', ['%curve%'])
    } finally {
      client.release()
    }
  }

  async fetchYV2() {
    const client = await db.connect()
    try {
      const result = await client.query('SELECT * FROM thing where defaults->>apiVersion = $1', ['2'])
      return snakeToCamelCols(result.rows)
    } finally {
      client.release()
    }
  }
}
