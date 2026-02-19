import { NextResponse } from 'next/server'
import { createKeyvClient } from '../../../cache'
import type { VaultListItem } from '../../db'

const keyv = createKeyvClient('list:vaults')

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
  const { searchParams } = new URL(request.url)
  const origin = searchParams.get('origin')

  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)

  if (isNaN(chainId)) {
    return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
  }

  let vaults: VaultListItem[] | undefined
  try {
    vaults = await keyv.get(String(chainId)) as VaultListItem[] | undefined
  } catch (err) {
    console.error(`Redis read failed for chainId ${chainId}:`, err)
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
      'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
      ...corsHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
