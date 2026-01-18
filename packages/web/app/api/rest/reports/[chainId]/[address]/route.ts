import { NextRequest, NextResponse } from 'next/server';
import { createReportsKeyv, getReportKey } from '../../redis';

export async function GET(
  request: NextRequest,
  { params }: { params: { chainId: string; address: string } }
) {
  const chainId = parseInt(params.chainId)
  const address = params.address.toLowerCase()

  if (isNaN(chainId)) {
    return NextResponse.json(
      { error: 'Invalid chainId' },
      { status: 400 }
    )
  }

  const keyv = createReportsKeyv()
  const key = getReportKey(chainId, address)
  const cached = await keyv.get(key)
  if (!cached) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    )
  }

  let data
  try {
     data = typeof cached === 'string' ? JSON.parse(cached) : cached
  } catch (e) {
    console.error('Failed to parse cached report', e)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
