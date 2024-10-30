import { ApolloServer } from '@apollo/server'
import { startServerAndCreateNextHandler } from '@as-integrations/next'
import { ApolloServerPluginCacheControl } from '@apollo/server/plugin/cacheControl'
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import responseCachePlugin from './responseCachePlugin'
import { createClient } from '@libsql/client'
import typeDefs from './typeDefs'
import resolvers from './resolvers'
import { NextRequest } from 'next/server'
import { LibSqlKeyvAdapter } from './LibSqlKeyvAdapter'
import { CORS_HEADERS } from '../headers'

const enableCache = process.env.GQL_ENABLE_CACHE === 'true'
const defaultCacheMaxAge = Number(process.env.GQL_DEFAULT_CACHE_MAX_AGE || 60 * 5)
const sqliteUrl = process.env.GQL_CACHE_SQLITE_URL || ''
const sqliteToken = process.env.GQL_CACHE_SQLITE_TOKEN || ''

const defaultQuery = `query Query {
  vaults {
    chainId
    address
    name
  }
}`

const plugins = [
  ApolloServerPluginLandingPageLocalDefault({ document: defaultQuery })
]

if (enableCache) {
  const client = createClient({ url: sqliteUrl, authToken: sqliteToken })
  const cache = new LibSqlKeyvAdapter(client)
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

export { respondTo as GET, respondTo as POST, OPTIONS }
