export const bull = { connection: {
  host: process.env.BULLMQ_REDIS_HOST || 'localhost',
  port: (process.env.BULLMQ_REDIS_PORT || 6379) as number,
}}
