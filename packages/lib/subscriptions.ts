import { z } from 'zod'
import * as yaml from 'js-yaml'
import * as fs from 'fs'
import path from 'path'

const WebhookFilterSchema = z.object({
  chainIds: z.array(z.number()).optional(),
  contracts: z.array(z.object({
    chainId: z.number(),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address')
  })).optional()
}).optional()

export const WebhookSubscriptionSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  abiPath: z.string(),
  type: z.enum(['timeseries']),
  label: z.string(),
  filter: WebhookFilterSchema.optional()
})

export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>

const YamlConfigSchema = z.object({
  subscriptions: z.array(WebhookSubscriptionSchema)
})

const yamlPath = (() => {
  const local = path.join(__dirname, '../../config', 'subscriptions.local.yaml')
  const production = path.join(__dirname, '../../config', 'subscriptions.yaml')
  if(fs.existsSync(local)) return local
  return production
})()

const yamlFile = fs.readFileSync(yamlPath, 'utf8')
const config = YamlConfigSchema.parse(yaml.load(yamlFile))
const { subscriptions: webhookSubscriptions } = config

export default webhookSubscriptions

export function shouldCallWebhook(
  subscription: WebhookSubscription,
  chainId: number,
  address: string
): boolean {
  // No filters = call for everything
  if (!subscription.filter) return true

  const { chainIds, contracts } = subscription.filter

  // Check specific contract matches first (most restrictive)
  if (contracts && contracts.length > 0) {
    return contracts.some(contract =>
      contract.chainId === chainId &&
      contract.address.toLowerCase() === address.toLowerCase()
    )
  }

  // Check chain ID matches
  if (chainIds && chainIds.length > 0) {
    return chainIds.includes(chainId)
  }

  // No specific filters defined = call for everything
  return true
}
