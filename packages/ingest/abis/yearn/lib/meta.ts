import { z } from 'zod'
import { cache } from 'lib'
import { StrategyMeta, StrategyMetaSchema, TokenMeta, TokenMetaSchema, VaultMeta, VaultMetaSchema } from 'lib/types'
import { getAddress } from 'viem'

type Metas<T> = { [address: `0x${string}`]: T }

export async function getVaultMeta(chainId: number, address: `0x${string}`) {
  try {
    return (await getMetas<VaultMeta>(VaultMetaSchema, chainId, 'vaults'))[getAddress(address)]
  } catch(error) {
    console.log('🤬', '!meta', chainId, address)
    return undefined
  }
}

export async function getStrategyMeta(chainId: number, address: `0x${string}`) {
  try {
    return (await getMetas<StrategyMeta>(StrategyMetaSchema, chainId, 'strategies'))[getAddress(address)]
  } catch(error) {
    console.log('🤬', '!meta', chainId, address)
    return undefined
  }
}

export async function getTokenMeta(chainId: number, address: `0x${string}`) {
  try {
    return (await getMetas<TokenMeta>(TokenMetaSchema, chainId, 'tokens'))[getAddress(address)]
  } catch(error) {
    console.log('🤬', '!meta', chainId, address)
    return undefined
  }
}

const memo = new Map<string, { value: unknown, expires: number }>()

async function getMetas<T>(schema: z.ZodType<T>, chainId: number, type: 'tokens' | 'vaults' | 'strategies'): Promise<Metas<T>> {
  const key = `abis/yearn/lib/meta/${type}/${chainId}`
  const hit = memo.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as Metas<T>

  const value = await cache.wrap(key, async () => {
    return await extractMetas<T>(schema, chainId, type)
  }, 5 * 60 * 1000)
  memo.set(key, { value, expires: Date.now() + 5 * 60 * 1000 })
  return value
}

async function extractMetas<T>(schema: z.ZodType<T>, chainId: number, type: 'tokens' | 'vaults' | 'strategies'): Promise<Metas<T>> {
  const json = await (await fetch(
    `https://cms.yearn.fi/cdn/${type}/${chainId}.json`,
    { signal: AbortSignal.timeout(10_000) }
  )).json()

  const results: { [address: `0x${string}`]: T } = {}
  for (const item of json) {
    try {
      const parsedItem = schema.parse(item)
      results[getAddress(item.address)] = parsedItem
    } catch(error) {
      console.log('🤬', '!meta', chainId, item.address)
    }
  }

  return results
}
