import { NextResponse } from 'next/server'
import { getListKey } from '../redis'
import { keyv } from '../../cache'
import type { VaultListItem } from '../db'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('origin')

  try {
    const allVaults = await keyv.get(getListKey('all')) as VaultListItem[] | undefined

    if (!allVaults) {
      return new NextResponse('Not found', { status: 404, headers: corsHeaders })
    }

    const filtered = origin
      ? allVaults.filter(v => v.origin === origin)
      : allVaults

    return NextResponse.json(filtered, {
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
