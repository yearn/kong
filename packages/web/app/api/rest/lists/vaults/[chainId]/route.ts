import { NextResponse } from 'next/server'
import { createListsKeyv } from '../../redis'

export const runtime = 'nodejs'

type VaultListItem = {
  chainId: number
  address: string
  name: string
}

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

  const vaults: VaultListItem[] = JSON.parse(cached as string)

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
