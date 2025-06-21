import { OpenAIConnector } from './openai'

export function createAiConnector(provider: 'openai') {
  if (provider === 'openai') {
    return new OpenAIConnector()
  }

  throw new Error(`Unsupported provider: ${provider}`)
}
