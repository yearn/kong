import { z } from 'zod'
import { crons, abisConfig, mq, strings, chains } from 'lib'
import prompts from 'prompts'
import { MenuAction } from '.'
import { CronSchema } from 'lib/crons'

export default {
  action,
  menu: { title: 'Crons', value: 'crons' }
} as MenuAction

const ChoiceSchema = CronSchema.and(z.object({
  title: z.string(),
  value: z.string(),
  scheduled: z.boolean(),
  chainId: z.number().optional()
}))

async function action() {
  const choices = ChoiceSchema.array().parse([])

  for(const cron of crons.default) {
    const job = mq.job[cron.queue][cron.job]
    if (job.bychain) {
      for (const chain of chains) {
        const q = mq.connect(`${cron.queue}-${chain.id}`)
        const repeatables = await q.getRepeatableJobs()
        await q.close()
        const scheduled = repeatables.some(job => job.name === cron.job)
        choices.push({ 
          ...cron,
          title: `${scheduled ? '🟢 enabled' : '🔴 disabled'} - ${cron.name}-${chain.id} (${cron.schedule})`,
          value: `${cron.name}-${chain.id}`,
          queue: `${cron.queue}-${chain.id}`,
          chainId: chain.id,
          scheduled
        })
      }

    } else {
      const q = mq.connect(cron.queue)
      const repeatables = await q.getRepeatableJobs()
      await q.close()
      const scheduled = repeatables.some(job => job.name === cron.job)
      choices.push({ 
        ...cron, 
        title: `${scheduled ? '🟢 enabled' : '🔴 disabled'} - ${cron.name} (${cron.schedule})`,
        value: cron.name,
        scheduled
      })

    }
  }

  {
    const q = mq.connect(abisConfig.cron.queue)
    const repeatables = await q.getRepeatableJobs()
    await q.close()
    const scheduled = repeatables.some(job => job.name === abisConfig.cron.job)
    choices.push(ChoiceSchema.parse({
      ...abisConfig.cron,
      title: `${scheduled ? '🟢 enabled' : '🔴 disabled'} - ${abisConfig.cron.name} (${abisConfig.cron.schedule})`,
      value: abisConfig.cron.name,
      scheduled
    }))
  }

  const { name, confirm } = await prompts([
    {
      type: 'select',
      name: 'name',
      message: 'pick a cron',
      choices: [...choices, ChoiceSchema.parse({ 
        name: 'all',
        job: 'all',
        queue: 'all',
        schedule: 'all',
        title: '*** toggle all cron ***', 
        value: 'all',
        scheduled: false
      })]
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (_, all) => `🤔 toggle ${all.name}?`,
    }
  ])

  if (confirm) {
    if(name === 'all') {
      if(choices.some(choice => choice.scheduled)) {
        for(const cron of choices.filter(c => c.scheduled)) {
          const q = mq.connect(cron.queue)
          await q.removeRepeatable(cron.job, { pattern: cron.schedule })
          await q.close()
          cron.scheduled = false
        }

      } else {
        for(const cron of choices) {
          const q = mq.connect(cron.queue)
          await q.add(cron.job, { id: strings.camelToSnake(cron.name), ...(cron.chainId === undefined ? {} : { chainId: cron.chainId }) }, {
            repeat: { pattern: cron.schedule }
          })
          await q.close()
          cron.scheduled = true
        }

      }
    } else {
      const cron = choices.find(c => c.value === name)
      if(!cron) return

      if(cron.scheduled) {
        const q = mq.connect(cron.queue)
        await q.removeRepeatable(cron.job, { pattern: cron.schedule })
        await q.close()
        cron.scheduled = false

      } else {
        const q = mq.connect(cron.queue)
        await q.add(cron.job, { id: strings.camelToSnake(cron.name), ...(cron.chainId === undefined ? {} : { chainId: cron.chainId }) }, {
          repeat: { pattern: cron.schedule }
        })
        await q.close()
        cron.scheduled = true
        console.log('⬆', 'cron up', cron.name)

      }
    }
  }
}
