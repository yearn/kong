import { NextResponse } from 'next/server'
import { createListsKeyv } from '../redis'
import type { VaultListItem } from '../db'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET() {
  const listsKeyv = createListsKeyv('list:vaults')

  try {
    if (!listsKeyv.iterator) {
      return new NextResponse('Iterator not supported', { status: 500, headers: corsHeaders })
    }

    const allVaults: VaultListItem[] = []

    for await (const [, value] of listsKeyv.iterator(listsKeyv.namespace)) {
      if (value) {
        try {
          const chainVaults: VaultListItem[] = JSON.parse(value)
          allVaults.push(...chainVaults)
        } catch (e) {
          console.error('Failed to parse vault list from Redis:', e)
        }
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
