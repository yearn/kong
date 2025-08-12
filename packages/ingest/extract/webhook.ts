import { z } from 'zod'
import { createHmac } from 'crypto'
import { mq } from 'lib'
import { OutputSchema, zhexstring } from 'lib/types'
import { WebhookSubscription, WebhookSubscriptionSchema } from 'lib/subscriptions'

export const DataSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  address: zhexstring,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  subscription: WebhookSubscriptionSchema
})

export type Data = z.infer<typeof DataSchema>

function generateWebhookSignature(secret: string, timestamp: number, body: string): string {
  const payload = `${timestamp}.${body}`
  const signature = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function getWebhookSecret(subscriptionId: string): string {
  const secret = process.env[`WEBHOOK_SECRET_${subscriptionId}`]
  if (!secret) {
    throw new Error(`Webhook secret not found, ${subscriptionId}`)
  }
  return secret
}

async function fetchResponse(subscription: WebhookSubscription, data: Data): Promise<Response> {
  try {
    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify(data)
    const secret = getWebhookSecret(subscription.id)
    const signature = generateWebhookSignature(secret, timestamp, body)

    return await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Kong-Signature': signature
      },
      body
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

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${response.statusText}`)
    }

    const body = await response.json()
    const outputs = OutputSchema.array().parse(body)

    if (outputs.some(output => output.label !== subscription.label)) {
      throw new Error(`Unexpected labels. Expected: ${subscription.label}, Got: ${outputs.map(output => output.label).join(', ')}`)
    }

    const MAX_OUTPUTS = 20
    if (outputs.length > MAX_OUTPUTS) {
      throw new Error(`Max outputs exceeded: ${outputs.length} > ${MAX_OUTPUTS}`)
    }

    await mq.add(mq.job.load.output, { batch: outputs })
  }
}
