import { NextRequest } from 'next/server'
import { z } from 'zod'

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
  const hook = KongWebhookSchema.parse(await request.json())

  // This healthcheck only runs when the address is yUSDS
  const yUSDS = '0x182863131F9a4630fF9E27830d945B1413e347E8'
  if(hook.address !== yUSDS) {
    return new Response(JSON.stringify([]), {
      headers: { 'Kong-Api-Key': process.env.KONG_API_KEY || 'NO API KEY' }
    })
  }

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
  return new Response(JSON.stringify(outputs, replacer), {
    headers: { 'Kong-Api-Key': process.env.KONG_API_KEY || 'NO API KEY' }
  })
}
