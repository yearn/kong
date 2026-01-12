import { NextResponse } from 'next/server'
import { createListsKeyv } from '../../redis'

import type { VaultListItem } from '../../db'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

const listsKeyv = createListsKeyv('list:vaults')

type RouteParams = {
  chainId?: string | string[]
}

export async function GET(
  _request: Request,
  context: { params: Promise<RouteParams> },
) {
  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)

  if (isNaN(chainId)) {
    return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
  }

  let cached
  try {
    cached = await listsKeyv.get(String(chainId))
  } catch (err) {
    console.error(`Redis read failed for chainId ${chainId}:`, err)
    throw err
  }

  if (!cached) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  let vaults: VaultListItem[]
  try {
    vaults = JSON.parse(cached as string)
  } catch (e) {
    console.error(`Failed to parse vault list for chain ${chainId}:`, e)
    return new NextResponse('Internal Server Error', { status: 500, headers: corsHeaders })
  }

  return NextResponse.json(vaults, {
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
