import { NextResponse } from 'next/server'
import { getKeyvClient, lastRefreshHeaders } from '../cache'
import type { AggregateTvlPayload } from './aggregate'
import { AGGREGATE_TVL_KEY } from './redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REFRESH_JOB = 'tvl-refresh'
const keyv = getKeyvClient()

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

function filterByChain(payload: AggregateTvlPayload, chainId: number): AggregateTvlPayload {
  const chains = payload.chains.filter((chain) => chain.chainId === chainId)
  return {
    ...payload,
    tvl: chains.reduce((total, chain) => total + chain.tvl, 0),
    grossTvl: chains.reduce((total, chain) => total + chain.grossTvl, 0),
    deductedTvl: chains.reduce((total, chain) => total + chain.deductedTvl, 0),
    chains,
    vaults: payload.vaults.filter((vault) => vault.chainId === chainId),
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

  let payload: AggregateTvlPayload | undefined
  let refreshHeaders: Record<string, string> = {}
  try {
    ;[payload, refreshHeaders] = await Promise.all([
      keyv.get(AGGREGATE_TVL_KEY) as Promise<AggregateTvlPayload | undefined>,
      lastRefreshHeaders(REFRESH_JOB),
    ])
  } catch (error) {
    console.error(`Redis read failed for ${AGGREGATE_TVL_KEY}:`, error)
    throw error
  }

  if (!payload) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { ...corsHeaders, ...refreshHeaders },
    })
  }

  const response = chainId === undefined ? payload : filterByChain(payload, chainId)

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
