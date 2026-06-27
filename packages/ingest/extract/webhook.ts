import { z } from 'zod'
import { createHmac } from 'crypto'
import { mq, sentry } from 'lib'
import { Output, OutputSchema, zhexstring } from 'lib/types'
import { WebhookSubscription, WebhookSubscriptionSchema } from 'lib/subscriptions'

export const DataSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  subscription: WebhookSubscriptionSchema,
  vaults: z.array(zhexstring)
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

const WEBHOOK_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB

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
      body,
      redirect: 'manual', // a receiver must not redirect worker egress elsewhere (SSRF)
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    })
  } catch (error) {
    console.error('🤬', 'webhook failed', subscription)
    throw error
  }
}

// Read and JSON-parse a response while enforcing a hard byte ceiling, so a receiver
// can't exhaust worker memory with an oversized (or content-length-lying) body.
export async function readJsonCapped(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Webhook response too large: ${declared} > ${maxBytes} bytes`)
  }
  const reader = response.body?.getReader()
  if (!reader) return response.json()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`Webhook response exceeded ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export const MAX_OUTPUTS_PER_VAULT = 100

// Drop any receiver output that isn't for the chain/vaults we asked it to compute,
// exceeds the per-vault cap, or carries an unexpected label, before it reaches the
// load queue. Scope filtering also bounds total groups to the requested vault set
// (FINDINGS.md findings 4-5, CWE-20 / CWE-400).
export function selectValidOutputs(outputs: Output[], data: Data): Output[] {
  const { subscription } = data
  const requestedVaults = new Set(data.vaults.map(v => v.toLowerCase()))
  const grouped = Map.groupBy(outputs, o => `${o.chainId}:${o.address}`)
  return [...grouped].flatMap(([key, group]) => {
    const [first] = group
    if (first.chainId !== data.chainId || !requestedVaults.has(first.address.toLowerCase())) {
      console.error(`🤬 ${subscription.id} skipping ${key}: out of requested scope`)
      sentry.captureMessage('WEBHOOK_OUT_OF_SCOPE', {
        level: 'warning',
        tags: { component: 'ingest', job: 'extract.webhook' },
        extra: { subscriptionId: subscription.id, key, requestedChainId: data.chainId }
      })
      return []
    }
    if (group.length > MAX_OUTPUTS_PER_VAULT) {
      console.error(`🤬 ${subscription.id} skipping ${key}: ${group.length} outputs > ${MAX_OUTPUTS_PER_VAULT}`)
      sentry.captureMessage('WEBHOOK_OUTPUTS_OVER_LIMIT', {
        level: 'warning',
        tags: { component: 'ingest', job: 'extract.webhook' },
        extra: { subscriptionId: subscription.id, key, outputs: group.length, max: MAX_OUTPUTS_PER_VAULT }
      })
      return []
    }
    if (group.some(o => !subscription.labels.includes(o.label))) {
      console.error(`🤬 ${subscription.id} skipping ${key}: unexpected labels`)
      sentry.captureMessage('WEBHOOK_UNEXPECTED_LABELS', {
        level: 'warning',
        tags: { component: 'ingest', job: 'extract.webhook' },
        extra: { subscriptionId: subscription.id, key }
      })
      return []
    }
    return group
  })
}

export class WebhookExtractor {
  async extract(data: Data) {
    data = DataSchema.parse(data)
    const { subscription } = data

    const semaphore = getWebhookSemaphore(subscription.url, 3) // throttle to 3 concurrent webhooks per url
    await semaphore.acquire()

    try {
      const label = `🔌 ${mq.job.extract.webhook.name} ${subscription.id} ${subscription.url} ${subscription.labels.join(', ')} (${data.vaults.length} vaults)`
      console.time(label)
      const response = await fetchResponse(subscription, data)
      console.timeEnd(label)

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`)
      }

      const body = await readJsonCapped(response)
      const outputs = OutputSchema.array().parse(body)
      const valid = selectValidOutputs(outputs, data)

      await mq.add(mq.job.load.output, { batch: valid })
    } finally {
      semaphore.release()
    }
  }
}

class Semaphore {
  private permits: number
  private waiting: Array<{ resolve: () => void, timeout: NodeJS.Timeout }>

  constructor(permits: number) {
    this.permits = permits
    this.waiting = []
  }

  async acquire(timeoutMs = 60 * 1000): Promise<void> { // 1 minute timeout
    return new Promise((resolve, reject) => {
      if (this.permits > 0) {
        this.permits--
        resolve()
        return
      }

      const timeout = setTimeout(() => {
        const index = this.waiting.findIndex(w => w.resolve === resolve)
        if (index !== -1) {
          this.waiting.splice(index, 1)
          reject(new Error('Semaphore acquire timeout'))
        }
      }, timeoutMs) as NodeJS.Timeout

      this.waiting.push({ resolve, timeout })
    })
  }

  release(): void {
    if (this.waiting.length > 0) {
      const { resolve, timeout } = this.waiting.shift()!
      clearTimeout(timeout)
      resolve()
    } else {
      this.permits++
    }
  }
}

const webhookSemaphores = new Map<string, Semaphore>()

function getWebhookSemaphore(url: string, maxConcurrency = 1): Semaphore {
  if (!webhookSemaphores.has(url)) {
    webhookSemaphores.set(url, new Semaphore(maxConcurrency))
  }
  return webhookSemaphores.get(url)!
}

// Cleanup functions for graceful shutdown
export function cleanupWebhookSemaphores(): void {
  for (const [_, semaphore] of webhookSemaphores.entries()) {
    // Release all waiting promises to prevent hanging
    while (semaphore['waiting'].length > 0) {
      const { resolve, timeout } = semaphore['waiting'].shift()!
      clearTimeout(timeout)
      resolve()
    }
  }
  webhookSemaphores.clear()
}

setInterval(() => {
  let cleaned = 0
  for (const [url, semaphore] of webhookSemaphores.entries()) {
    if (semaphore['waiting'].length === 0 && semaphore['permits'] === 1) {
      webhookSemaphores.delete(url)
      cleaned++
    }
  }
  if (cleaned > 0) { console.log('🧹', 'cleaned up', cleaned, 'unused webhook semaphores') }
}, 30 * 60 * 1000)
