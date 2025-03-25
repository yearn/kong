import { z } from 'zod'
import * as yaml from 'js-yaml'
import * as fs from 'fs'
import path from 'path'

export const CronSchema = z.object({
  name: z.string(),
  queue: z.string(),
  job: z.string(),
  schedule: z.string(),
  start: z.boolean().optional().default(false),
})

export type Cron = z.infer<typeof CronSchema>

const YamlSchema = z.object({
  crons: CronSchema.array()
})

const yamlPath = path.join(__dirname, '../../config', 'crons.yaml')
const yamlFile = fs.readFileSync(yamlPath, 'utf8')
const config = YamlSchema.parse(yaml.load(yamlFile))
export default config.crons
