import { NextResponse } from 'next/server'
import { getCurrentState, lastRefreshHeaders } from '../../cache'
import { restCacheControl } from '../../history'
import { getCurrentList } from '../db'

export const runtime = 'nodejs'

const REFRESH_JOB = 'refresh-cache'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET(request: Request) {
  const requestedAt = Date.now()
  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('origin')

  try {
    const [allVaults, refreshHeaders] = await Promise.all([
      getCurrentState('rest:list:vaults:all', () => getCurrentList()),
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
        'cache-control': restCacheControl(requestedAt),
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
