import { NextRequest, NextResponse } from 'next/server'
import { getSnapshotKey } from '../../redis'
import { keyv } from '../../../cache'
import type { VaultSnapshot } from '../../db'

export const runtime = 'nodejs'

type RouteParams = {
  chainId?: string | string[]
  address?: string | string[]
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
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
  try {
    parsed = await keyv.get(cacheKey)
  } catch (err) {
    console.error(`Redis read failed for ${cacheKey}:`, err)
    throw err
  }

  if (!parsed) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  return NextResponse.json(parsed, {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
      ...corsHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
