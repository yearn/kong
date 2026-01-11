import { NextResponse } from 'next/server'
import { createListsKeyv } from '../redis'

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
  const keyv = createListsKeyv('list:vaults')

  try {
    if (!keyv.iterator) {
      return new NextResponse('Iterator not supported', { status: 500, headers: corsHeaders })
    }

    const allVaults: VaultListItem[] = []

    for await (const [, value] of keyv.iterator(keyv.namespace)) {
      if (value) {
        const chainVaults: VaultListItem[] = JSON.parse(value)
        allVaults.push(...chainVaults)
      }
    }

    return NextResponse.json(allVaults, {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
        ...corsHeaders,
      },
    })
  } catch (err) {
    console.error('Redis operation failed:', err)
    throw err
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
