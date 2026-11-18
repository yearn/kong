import { NextResponse } from 'next/server'
import { getCurrentState, lastRefreshHeaders } from '../../../cache'
import { restCacheControl } from '../../../history'
import { getCurrentList, type VaultListItem } from '../../db'

export const runtime = 'nodejs'

const REFRESH_JOB = 'refresh-cache'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

type RouteParams = {
  chainId?: string | string[]
}

export async function GET(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  const requestedAt = Date.now()
  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('origin')

  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)

  if (isNaN(chainId)) {
    return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
  }

  let vaults: VaultListItem[] | undefined
  let refreshHeaders: Record<string, string> = {}
  try {
    ;[vaults, refreshHeaders] = await Promise.all([
      getCurrentState(`rest:list:vaults:${chainId}`, () => getCurrentList(chainId)),
      lastRefreshHeaders(REFRESH_JOB),
    ])
  } catch (err) {
    console.error(`REST state read failed for chainId ${chainId}:`, err)
    throw err
  }

  if (!vaults) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  const filtered = origin
    ? vaults.filter(v => v.origin === origin)
    : vaults

  return NextResponse.json(filtered, {
    status: 200,
    headers: {
      'cache-control': restCacheControl(requestedAt),
      ...corsHeaders,
      ...refreshHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
