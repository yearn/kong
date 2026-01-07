import { NextResponse } from 'next/server'
import { createRedisClient } from '../redis'

export const runtime = 'nodejs'

type VaultListItem = {
  chainId: number
  address: string
  name: string
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET() {
  const client = await createRedisClient()

  try {
    // Scan for all keys matching pattern list:vaults:*
    const pattern = 'list:vaults:*'
    const keys = await client.keys(pattern)

    if (keys.length === 0) {
      await client.quit()
      return new NextResponse('Not found', { status: 404, headers: corsHeaders })
    }

    // Fetch all chain-specific lists
    const allVaults: VaultListItem[] = []
    for (const key of keys) {
      const data = await client.get(key)
      if (data) {
        const wrapped = JSON.parse(data)
        const chainVaults: VaultListItem[] = JSON.parse(wrapped.value)
        allVaults.push(...chainVaults)
      }
    }

    await client.quit()

    return NextResponse.json(allVaults, {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
        ...corsHeaders,
      },
    })
  } catch (err) {
    console.error('Redis operation failed:', err)
    await client.quit()
    throw err
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
