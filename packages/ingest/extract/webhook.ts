import { z } from 'zod'
import { mq } from 'lib'
import { OutputSchema, zhexstring } from 'lib/types'
import { getWebhookSubscriptionApiKeys, WebhookSubscription, WebhookSubscriptionSchema } from 'lib/subscriptions'

export const DataSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  address: zhexstring,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  subscription: WebhookSubscriptionSchema
})

export type Data = z.infer<typeof DataSchema>

async function fetchResponse(subscription: WebhookSubscription, data: Data): Promise<Response> {
  try {
    return await fetch(subscription.url, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  } catch (error) {
    console.error('🤬', 'webhook failed', subscription.url)
    throw error
  }
}

export class WebhookExtractor {
  async extract(data: Data) {
    data = DataSchema.parse(data)
    const { subscription } = data

    const label = `🔌 ${mq.job.extract.webhook.name} ${subscription.id} ${subscription.url} ${subscription.label}`
    console.time(label)
    const response = await fetchResponse(subscription, data)
    console.timeEnd(label)

    const apikey = response.headers.get('Kong-Api-Key')
    if (!apikey) { throw new Error('Missing apikey') }

    const subscriberApiKeys = getWebhookSubscriptionApiKeys()
    const validateApiKey = subscriberApiKeys.find(
      item => item.subscriptionId === subscription.id && item.apiKey === apikey
    ) || false
    if (!validateApiKey) { throw new Error('Invalid apikey') }

    const body = await response.json()
    const outputs = OutputSchema.array().parse(body)

    if (outputs.some(output => output.label !== subscription.label)) {
      throw new Error(`Unexpected labels. Expected: ${subscription.label}, Got: ${outputs.map(output => output.label).join(', ')}`)
    }

    await mq.add(mq.job.load.output, { batch: outputs })
  }
}
