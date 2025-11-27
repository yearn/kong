import { NextRequest, NextResponse } from 'next/server'
import { labels } from '../../../labels'
import { createTimeseriesKeyv, getTimeseriesKey } from '../../../redis'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

export const timeseriesKeyv = createTimeseriesKeyv()

export async function GET(
  request: NextRequest,
  context: { params: { segment: string; chainId: string; address: string } },
) {
  const { segment, chainId, address } = context.params
  const entry = labels.find((label) => label.segment === segment)

  if (!entry) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  const searchParams = new URL(request.url).searchParams
  const requestedComponents = searchParams.getAll('components')
  const components = requestedComponents.length
    ? requestedComponents
    : [entry.defaultComponent]

  const addressLower = address.toLowerCase()
  const cacheKey = getTimeseriesKey(entry.label, Number(chainId), addressLower)
  const cached = await timeseriesKeyv.get(cacheKey)
  const parsed: Array<{ time: number; component: string; value: number }> = cached
    ? JSON.parse(cached as string)
    : []

  const filtered = parsed.filter((row) => components.includes(row.component))

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
