import { ApolloServer } from '@apollo/server'
import { ApolloServerPluginCacheControl } from '@apollo/server/plugin/cacheControl'
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import { startServerAndCreateNextHandler } from '@as-integrations/next'
import KeyvRedis from '@keyv/redis'
import Keyv from 'keyv'
import { NextRequest } from 'next/server'
import { CORS_HEADERS } from '../headers'
import { CustomKeyvAdapter } from './CustomKeyvAdapter'
import resolvers from './resolvers'
import responseCachePlugin from './responseCachePlugin'
import typeDefs from './typeDefs'

const enableCache = process.env.GQL_ENABLE_CACHE === 'true'
const defaultCacheMaxAge = Number(process.env.GQL_DEFAULT_CACHE_MAX_AGE || 60 * 5)
const redisUrl = process.env.GQL_CACHE_REDIS_URL || 'redis://localhost:6379'

const defaultQuery = `query Query {
  vaults(chainId: 1) {
    chainId
    address
    name
  }
}`

const plugins = [
  ApolloServerPluginLandingPageLocalDefault({ document: defaultQuery })
]

if (enableCache) {
  const store = new KeyvRedis(redisUrl)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = new CustomKeyvAdapter(new Keyv<string>({ store: store as any }))
  plugins.push(ApolloServerPluginCacheControl({ defaultMaxAge: defaultCacheMaxAge }))
  plugins.push(responseCachePlugin({ cache }))
}

const server = new ApolloServer({
  resolvers,
  typeDefs,
  plugins,
  introspection: true
})

const handle = startServerAndCreateNextHandler(server)

async function respondTo(request: NextRequest) {
  const response = await handle(request)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

async function OPTIONS() {
  const response = new Response('', { headers: CORS_HEADERS })
  return response
}

export { respondTo as GET, OPTIONS, respondTo as POST }

