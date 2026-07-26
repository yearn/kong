import { NextResponse } from 'next/server'
import { getKeyvClient } from '../../cache'
import type { TrancheSystem } from '../db'
import { getTrancheKey } from '../redis'

const keyv = getKeyvClient()

export const runtime = 'nodejs'

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
  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)

  if (isNaN(chainId)) {
    return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
  }

  let system: TrancheSystem | undefined
  try {
    system = await keyv.get(getTrancheKey(chainId)) as TrancheSystem | undefined
  } catch (err) {
    console.error(`Redis read failed for chainId ${chainId}:`, err)
    throw err
  }

  if (!system) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  return NextResponse.json(system, {
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
