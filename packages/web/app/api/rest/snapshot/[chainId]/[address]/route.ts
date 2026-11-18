import { NextRequest, NextResponse } from 'next/server'
import { getCurrentState, lastRefreshHeaders } from '../../../cache'
import { restCacheControl } from '../../../history'
import { getCurrentSnapshot, type VaultSnapshot } from '../../db'
import { getSnapshotKey } from '../../redis'

export const runtime = 'nodejs'

type RouteParams = {
  chainId?: string | string[]
  address?: string | string[]
}

const REFRESH_JOB = 'refresh-cache'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  const requestedAt = Date.now()
  const { chainId, address } = (await context.params) ?? {}

  if (
    typeof chainId !== 'string' ||
    typeof address !== 'string'
  ) {
    return new NextResponse('Invalid params', { status: 400, headers: corsHeaders })
  }

  const addressLower = address.toLowerCase()
  const cacheKey = getSnapshotKey(Number(chainId), addressLower)

  let parsed: VaultSnapshot | undefined
  let refreshHeaders: Record<string, string> = {}
  try {
    ;[parsed, refreshHeaders] = await Promise.all([
      getCurrentState(cacheKey, () => getCurrentSnapshot(Number(chainId), addressLower)),
      lastRefreshHeaders(REFRESH_JOB),
    ])
  } catch (err) {
    console.error(`REST state read failed for ${cacheKey}:`, err)
    throw err
  }

  if (!parsed) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  return NextResponse.json(parsed, {
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
