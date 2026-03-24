import { NextRequest, NextResponse } from 'next/server'
import { getKeyvClient } from '../../../cache'
import { VaultReport } from '../../db'
import { getReportKey, getReportLatestKey } from '../../redis'

const keyv = getKeyvClient()

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

  const historicalKey = getReportKey(chainId, address)
  const latestKey = getReportLatestKey(chainId, address)

  const [historical, latest] = await Promise.all([
    keyv.get(historicalKey) as Promise<VaultReport[] | undefined>,
    keyv.get(latestKey) as Promise<VaultReport[] | undefined>,
  ])

  if (!historical && !latest) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    )
  }

  // Merge: dedupe by txHash+logIndex, latest wins, keep DESC order, cap at 1000
  const latestTxKeys = new Set(
    (latest || []).map((r) => `${r.transactionHash}:${r.logIndex}`)
  )
  const merged = [
    ...(latest || []),
    ...(historical || []).filter((r) => !latestTxKeys.has(`${r.transactionHash}:${r.logIndex}`)),
  ].slice(0, 1000)

  return NextResponse.json(merged, {
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
