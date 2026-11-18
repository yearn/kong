import { NextResponse } from 'next/server'
import { getCurrentState } from '../../../cache'
import { restCacheControl } from '../../../history'
import { getTrancheSystems, type TrancheSystem } from '../../db'
import { getTrancheControllersKey } from '../../redis'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

type RouteParams = {
  chainId?: string | string[]
}

// Every tranche system on a chain, one document per controller. `controllers` is
// a static segment, so it resolves ahead of the sibling [controller] member route
// and can never be mistaken for an address.
export async function GET(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  const requestedAt = Date.now()
  const { chainId: chainIdParam } = (await context.params) ?? {}
  const chainId = parseInt(chainIdParam as string, 10)

  if (isNaN(chainId)) {
    return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
  }

  let systems: TrancheSystem[] | undefined
  try {
    systems = await getCurrentState(getTrancheControllersKey(chainId), () => getTrancheSystems(undefined, chainId))
  } catch (err) {
    console.error(`REST state read failed for chainId ${chainId}:`, err)
    throw err
  }

  if (!systems?.length) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  return NextResponse.json(systems, {
    status: 200,
    headers: {
      'cache-control': restCacheControl(requestedAt),
      ...corsHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
