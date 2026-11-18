import { NextResponse } from 'next/server'
import { getCurrentState, lastRefreshHeaders } from '../cache'
import { restCacheControl } from '../history'
import db from '../../db'
import { getCurrentAggregate } from './refresh'
import { AGGREGATE_TVL_KEY, AGGREGATE_TVL_SUMMARY_KEY, type AggregateTvlSummary } from './redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REFRESH_JOB = 'tvl-refresh'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

type TvlResponse = {
  tvl: number
  unpricedVaults: number
  chains: { chainId: number, tvl: number, unpricedVaults: number }[]
}

function toResponse(payload: AggregateTvlSummary, chainId?: number): TvlResponse {
  const chains = payload.chains
    .filter((chain) => chainId === undefined || chain.chainId === chainId)
    .map(({ chainId, tvl, unpricedVaults }) => ({ chainId, tvl, unpricedVaults: unpricedVaults ?? 0 }))
  return {
    tvl: chains.reduce((total, chain) => total + chain.tvl, 0),
    unpricedVaults: chains.reduce((total, chain) => total + chain.unpricedVaults, 0),
    chains,
  }
}

export async function GET(request: Request) {
  const requestedAt = Date.now()
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
    const read = async () => (await getCurrentAggregate(db)).summary
    payload = await getCurrentState(AGGREGATE_TVL_SUMMARY_KEY, read)
      ?? await getCurrentState(AGGREGATE_TVL_KEY, read)
  } catch (error) {
    console.error('REST state read failed for aggregate TVL:', error)
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
      'cache-control': restCacheControl(requestedAt),
      ...corsHeaders,
      ...payloadRefreshHeaders,
    },
  })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
