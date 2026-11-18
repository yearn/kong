import { NextRequest, NextResponse } from 'next/server'
import { getKeyvClient, lastRefreshHeaders } from '../../../cache'
import { restCacheControl, restHistoryStart } from '../../../history'
import { VaultReport } from '../../db'
import { getReportKey, getReportLatestKey } from '../../redis'

const keyv = getKeyvClient()

const REFRESH_JOB = 'reports-refresh'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> }
) {
  const requestedAt = Date.now()
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

  const [historical, latest, refreshHeaders] = await Promise.all([
    keyv.get(historicalKey) as Promise<VaultReport[] | undefined>,
    keyv.get(latestKey) as Promise<VaultReport[] | undefined>,
    lastRefreshHeaders(REFRESH_JOB),
  ])

  const cutoff = restHistoryStart()
  const recentReports = (latest ?? []).filter(report => Number(report.blockTime) >= cutoff)
  const historicalReports = (historical ?? []).filter(report => Number(report.blockTime) >= cutoff)
  if (!historicalReports.length && !recentReports.length) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    )
  }

  // Merge: dedupe by txHash+logIndex, latest wins, keep DESC order, cap at 1000
  const latestTxKeys = new Set(
    recentReports.map((r) => `${r.transactionHash}:${r.logIndex}`)
  )
  const merged = [
    ...recentReports,
    ...historicalReports.filter((r) => !latestTxKeys.has(`${r.transactionHash}:${r.logIndex}`)),
  ].slice(0, 1000)

  return NextResponse.json(merged, {
    headers: {
      'Cache-Control': restCacheControl(requestedAt),
      ...corsHeaders,
      ...refreshHeaders,
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
