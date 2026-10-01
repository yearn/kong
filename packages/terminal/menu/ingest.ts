import { mq } from 'lib'
import prompts from 'prompts'
import { MenuAction } from '.'

export default {
  action,
  menu: { title: 'Ingest', value: 'ingest' }
} as MenuAction

async function action() {
  const { q, confirm } = await prompts([
    {
      type: 'select',
      name: 'q',
      message: 'pick an ingest job',
      choices: [
        { title: 'fanout abis', value: {
          job: mq.job.fanout.abis
        }},
        { title: 'fanout replays', value: {
          job: mq.job.fanout.abis,
          data: { replay: {
            enabled: true
          }}
        }},
        { title: 'extract manauls', value: {
          job: mq.job.extract.manuals
        }},
      ]
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (_, all) => `🤔 ${all.q.job.queue}/${all.q.job.name}?`,
    }
  ])

  if (confirm) {
    await mq.add(q.job, q.data || {})
  }
}
