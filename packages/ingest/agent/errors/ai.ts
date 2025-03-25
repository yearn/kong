import { z } from 'zod'
import { createAiConnector } from 'lib/ai'

export function summarize(logs: string[]) {
  const ai = createAiConnector('openai')
  return ai.compute({
    system: `
  You are an AI assistant that processes stack traces.
  Your task is to analyze a list of stack traces and perform the following actions:
  Remove duplicates: Identify and eliminate identical or near-identical stack traces, keeping only one unique instance.
  Censor sensitive information: Detect and anonymize any sensitive data such as user IDs, IP addresses, emails, or other private details by replacing them with [REDACTED].
  Improve readability: Rewrite each stack trace in clear, human-readable language that explains the issue.
`,
    user: logs.join('\n')
  }, z.object({
    summary: z.array(z.string())
  }), 'summary')
}
