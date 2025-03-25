import { ZodType } from 'zod'
import { AiConnector, Prompt } from './base'
import { OpenAI } from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'

export class OpenAIConnector implements AiConnector {
  client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async compute<T>(prompt: Prompt, outputSchema: ZodType, outputKey: string): Promise<T | null> {
    if(!process.env.OPENAI_API_KEY) {
      console.log('😭 OPENAI_API_KEY is not set')
      return null
    }

    const completion = await this.client.beta.chat.completions.parse({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt.system}, {
        role: 'user',
        content: prompt.user
      }],
      response_format: zodResponseFormat(outputSchema, outputKey)
    })

    return completion.choices[0].message.parsed
  }
}
