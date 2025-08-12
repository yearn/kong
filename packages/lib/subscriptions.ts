import { z } from 'zod'
import * as yaml from 'js-yaml'
import * as fs from 'fs'
import path from 'path'

export const WebhookSubscriptionSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  abiPath: z.string(),
  type: z.enum(['timeseries']),
  label: z.string()
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
