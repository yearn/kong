import { NextRequest, NextResponse } from 'next/server'
import { createKeyvClient } from '../../../cache'
import { VaultReport } from '../../db'
import { getReportKey } from '../../redis'

const keyv = createKeyvClient()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> }
) {
  const { chainId: chainIdStr, address: addressStr } = await params
  const chainId = parseInt(chainIdStr)
  const address = addressStr.toLowerCase()

  if (isNaN(chainId)) {
    return NextResponse.json(
      { error: 'Invalid chainId' },
      { status: 400 }
    )
  }

  const key = getReportKey(chainId, address)
  const data = await keyv.get(key) as VaultReport[] | undefined

  if (!data) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
      ...corsHeaders,
    }
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
