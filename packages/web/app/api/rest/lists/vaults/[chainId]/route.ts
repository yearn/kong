import { NextResponse } from 'next/server'
import { createListsKeyv, getListKey } from '../../redis'

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

const listsKeyv = createListsKeyv()

type RouteParams = {
  chainId?: string | string[]
}

export async function GET(
  _request: Request,
  context: { params: Promise<RouteParams> },
) {
  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)
  const listKey = getListKey('vaults', chainId)
  let cached
  try {
    cached = await listsKeyv.get(listKey)
  } catch (err) {
    console.error(`Redis read failed for ${listKey}:`, err)
    throw err
  }

  if (!cached) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  const wrapped = JSON.parse(cached as string)
  const vaults: VaultListItem[] = JSON.parse(wrapped.value)

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
