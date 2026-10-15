import { NextResponse } from 'next/server'
import { getKeyvClient, lastRefreshHeaders } from '../../cache'
import type { VaultListItem } from '../db'

const keyv = getKeyvClient()

export const runtime = 'nodejs'

const REFRESH_JOB = 'refresh-cache'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('origin')

  try {
    const [allVaults, refreshHeaders] = await Promise.all([
      keyv.get('rest:list:vaults:all') as Promise<VaultListItem[] | undefined>,
      lastRefreshHeaders(REFRESH_JOB),
    ])

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
        ...refreshHeaders,
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
