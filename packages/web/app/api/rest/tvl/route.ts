import { NextResponse } from 'next/server'
import { getKeyvClient, lastRefreshHeaders } from '../cache'
import { AGGREGATE_TVL_KEY, AGGREGATE_TVL_SUMMARY_KEY, type AggregateTvlSummary } from './redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REFRESH_JOB = 'tvl-refresh'
const keyv = getKeyvClient()

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

type TvlResponse = {
  tvl: number
  chains: { chainId: number, tvl: number }[]
}

function toResponse(payload: AggregateTvlSummary, chainId?: number): TvlResponse {
  const chains = payload.chains
    .filter((chain) => chainId === undefined || chain.chainId === chainId)
    .map(({ chainId, tvl }) => ({ chainId, tvl }))
  return {
    tvl: chains.reduce((total, chain) => total + chain.tvl, 0),
    chains,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const chainIdParam = searchParams.get('chainId')
  let chainId: number | undefined

  if (chainIdParam !== null) {
    if (!/^\d+$/.test(chainIdParam)) {
      return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
    }

    chainId = Number(chainIdParam)
    if (!Number.isSafeInteger(chainId)) {
      return new NextResponse('Invalid chainId', { status: 400, headers: corsHeaders })
    }
  }

  let payload: AggregateTvlSummary | undefined
  try {
    payload = await keyv.get(AGGREGATE_TVL_SUMMARY_KEY) as AggregateTvlSummary | undefined
    // Serve the previous deployment's cache until the first summary refresh.
    if (!payload) payload = await keyv.get(AGGREGATE_TVL_KEY) as AggregateTvlSummary | undefined
  } catch (error) {
    console.error('Redis read failed for aggregate TVL:', error)
    throw error
  }

  if (!payload) {
    const refreshHeaders = await lastRefreshHeaders(REFRESH_JOB)
    return new NextResponse('Not found', {
      status: 404,
      headers: { ...corsHeaders, ...refreshHeaders },
    })
  }

  const response = toResponse(payload, chainId)

  const payloadRefreshHeaders = {
    'x-last-refresh': payload.updatedAt,
    'access-control-expose-headers': 'x-last-refresh',
  }

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
      ...corsHeaders,
      ...payloadRefreshHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
