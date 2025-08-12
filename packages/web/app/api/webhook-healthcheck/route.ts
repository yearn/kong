import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'crypto'

const AddressSchema = z.custom<`0x${string}`>(
  val => typeof val === 'string' && /^0x[0-9a-fA-F]{40}$/.test(val),
  'invalid evm address'
)

const KongWebhookSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  address: AddressSchema,
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true }),
  subscription: z.object({
    id: z.string(),
    url: z.string().url(),
    abiPath: z.string(),
    type: z.enum(['timeseries']),
    label: z.string()
  })
})

const OutputSchema = z.object({
  chainId: z.number(),
  address: AddressSchema,
  label: z.string(),
  component: z.string().nullish(),
  value: z.any().transform(val => {
    const result = z.number().safeParse(val)
    if(result.success && isFinite(result.data)) return result.data
    return undefined
  }).nullish(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export async function OPTIONS() {
  return new Response('', {})
}

export async function POST(request: NextRequest) {
  // Verify HMAC signature
  const signature = request.headers.get('Kong-Signature')
  if (!signature) {
    return new Response('Missing signature', { status: 401 })
  }

  const body = await request.text()
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) { return new Response('Missing secret', { status: 401 }) }

  if (!verifyWebhookSignature(signature, secret, body)) {
    return new Response('Invalid signature', { status: 401 })
  }

  const hook = KongWebhookSchema.parse(JSON.parse(body))

  const outputs = OutputSchema.array().parse([
    OutputSchema.parse({
      chainId: hook.chainId,
      address: hook.address,
      label: hook.subscription.label,
      component: 'health', value: 0,
      blockNumber: hook.blockNumber,
      blockTime: hook.blockTime
    }),
    OutputSchema.parse({
      chainId: hook.chainId,
      address: hook.address,
      label: hook.subscription.label,
      component: 'check', value: 1,
      blockNumber: hook.blockNumber,
      blockTime: hook.blockTime
    })
  ])

  const replacer = (_: string, v: unknown) => typeof v === 'bigint' ? v.toString() : v
  return new Response(JSON.stringify(outputs, replacer))
}

function verifyWebhookSignature(
  signatureHeader: string,
  secret: string,
  body: string,
  toleranceSeconds = 300 // 5 minutes
): boolean {
  try {
    // Parse signature header: "t=1234567890,v1=abc123..."
    const elements = signatureHeader.split(',')
    const timestampElement = elements.find(el => el.startsWith('t='))
    const signatureElement = elements.find(el => el.startsWith('v1='))

    if (!timestampElement || !signatureElement) {
      return false
    }

    const timestamp = parseInt(timestampElement.split('=')[1])
    const receivedSignature = signatureElement.split('=')[1]

    // Check timestamp tolerance to prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - timestamp) > toleranceSeconds) {
      return false
    }

    // Generate expected signature
    const expectedSignature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(
      new Uint8Array(Buffer.from(receivedSignature, 'hex')),
      new Uint8Array(Buffer.from(expectedSignature, 'hex'))
    )
  } catch (error) {
    console.error(error)
    return false
  }
}
