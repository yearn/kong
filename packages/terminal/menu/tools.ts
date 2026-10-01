import { chains, mq } from 'lib'
import prompts from 'prompts'
import { MenuAction } from '.'
import { createClient } from 'redis'
import db from '../../ingest/db'

export default {
  action,
  menu: { title: 'Tools', value: 'tools' }
} as MenuAction

async function action() {
  const { tool, confirm } = await prompts([
    {
      type: 'select',
      name: 'tool',
      message: '',
      choices: [
        { title: 'flush failed jobs', value: 'flush-failed-jobs' },
        { title: 'flush redis', value: 'flush-redis' },
        { title: 'reset database', value: 'reset-database' }
      ]
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (_, all) => `🤔 ${all.tool}?`,
    }
  ])

  if (confirm) {
    switch(tool) {
    case 'flush-failed-jobs': {
      const keys = [...Object.keys(mq.q), ...chains.map(chain => `extract-${chain.id}`)]
      for(const key of keys) {
        const queue = mq.connect(key)
        await queue.clean(0, Number.MAX_SAFE_INTEGER, 'failed')
        await queue.close()
      }
      break
    }

    case 'flush-redis': {
      const client = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${(process.env.REDIS_PORT || 6379) as number}`
      })
      await client.connect()
      await client.flushAll()
      await client.quit()
      break
    }

    case 'reset-database': {
      await db.query(`
          TRUNCATE TABLE evmlog;
          TRUNCATE TABLE evmlog_strides;
          TRUNCATE TABLE thing;
          TRUNCATE TABLE snapshot;
          TRUNCATE TABLE output;
          TRUNCATE TABLE price;
        `)
      await db.query('VACUUM FULL evmlog;')
      await db.query('REINDEX TABLE evmlog;')
      await db.query('VACUUM FULL evmlog_strides;')
      await db.query('REINDEX TABLE evmlog_strides;')
      await db.query('VACUUM FULL thing;')
      await db.query('REINDEX TABLE thing;')
      await db.query('VACUUM FULL snapshot;')
      await db.query('REINDEX TABLE snapshot;')
      await db.query('VACUUM FULL output;')
      await db.query('REINDEX TABLE output;')
      await db.query('VACUUM FULL price;')
      await db.query('REINDEX TABLE price;')
      break
    }
    }
  }
}
