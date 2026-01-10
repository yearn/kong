export const bull = { connection: {
  host: process.env.MQ_REDIS_HOST || 'localhost',
  port: (process.env.MQ_REDIS_PORT || 6379) as number,
  ...(process.env.MQ_REDIS_USERNAME ? { username: process.env.MQ_REDIS_USERNAME } : {}),
  ...(process.env.MQ_REDIS_PASSWORD ? { password: process.env.MQ_REDIS_PASSWORD } : {}),
  ...(process.env.MQ_REDIS_TLS === 'true' ? { tls: {} } : {})
}}
