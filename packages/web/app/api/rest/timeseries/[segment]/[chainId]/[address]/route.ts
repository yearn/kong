import { NextRequest, NextResponse } from 'next/server'
import { getKeyvClient } from '../../../../cache'
import { labels } from '../../../labels'
import { getTimeseriesKey, getTimeseriesLatestKey } from '../../../redis'

export const runtime = 'nodejs'

type RouteParams = {
  segment?: string | string[]
  chainId?: string | string[]
  address?: string | string[]
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

const timeseriesKeyv = getKeyvClient()

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  const { segment, chainId, address } = (await context.params) ?? {}

  if (
    typeof segment !== 'string' ||
    typeof chainId !== 'string' ||
    typeof address !== 'string'
  ) {
    return new NextResponse('Invalid params', { status: 400, headers: corsHeaders })
  }

  const entry = labels.find((label) => label.segment === segment)

  if (!entry) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  const searchParams = new URL(request.url).searchParams
  const requestedComponents = searchParams.getAll('components')
  const components = requestedComponents.length
    ? requestedComponents
    : [entry.defaultComponent]

  type TimeseriesEntry = { time: number; component: string; value: number }

  const addressLower = address.toLowerCase()
  const chainIdNum = Number(chainId)
  const historicalKey = getTimeseriesKey(entry.label, chainIdNum, addressLower)
  const latestKey = getTimeseriesLatestKey(entry.label, chainIdNum, addressLower)

  let historical: TimeseriesEntry[] = []
  let latest: TimeseriesEntry[] = []
  try {
    const [historicalCached, latestCached] = await Promise.all([
      timeseriesKeyv.get(historicalKey),
      timeseriesKeyv.get(latestKey),
    ])
    historical = (historicalCached as TimeseriesEntry[]) || []
    latest = (latestCached as TimeseriesEntry[]) || []
  } catch (err) {
    console.error(`Redis read failed for ${historicalKey}:`, err)
    throw err
  }

  // Merge: latest rows override historical rows for the same time+component
  const latestTimes = new Set(latest.map((r) => `${r.time}:${r.component}`))
  const merged = [
    ...historical.filter((r) => !latestTimes.has(`${r.time}:${r.component}`)),
    ...latest,
  ].sort((a, b) => a.time - b.time)

  const filtered = merged.filter((row) => components.includes(row.component))

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
