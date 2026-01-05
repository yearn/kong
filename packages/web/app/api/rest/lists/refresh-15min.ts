import { createKeyv } from '@keyv/redis'
import { getVaultsList } from './db'

const REDIS_LIST_KEY = 'list:vaults'

async function refresh15min(): Promise<void> {
  console.time('refresh15min')

  const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
  const keyv = createKeyv(redisUrl)

  console.log('Fetching vaults list...')
  const vaults = await getVaultsList()
  console.log(`Found ${vaults.length} vaults`)

  console.log('Storing list in Redis...')
  await keyv.set(REDIS_LIST_KEY, JSON.stringify(vaults))

  console.log(`✓ Completed: ${vaults.length} vaults cached`)
  console.timeEnd('refresh15min')
}

if (require.main === module) {
  refresh15min()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
