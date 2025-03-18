import { z } from 'zod'

export interface Prompt {
  system: string;
  user: string;
}

export interface AiConnector {
  compute<T>(prompt: Prompt, outputSchema: z.ZodSchema, outputKey: string): Promise<T | null>;
}
