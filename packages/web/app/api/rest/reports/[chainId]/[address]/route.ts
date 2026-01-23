import { NextRequest, NextResponse } from 'next/server'
import { createReportsKeyv, getReportKey} from '../../redis'
import { VaultReport } from '../../db'

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

  const keyv = createReportsKeyv()

  const key = getReportKey(chainId)


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

    console.log(data)
    const vaultReports = data.find((report: VaultReport) => report.address.toLowerCase() === address.toLowerCase())

    if (!vaultReports) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(vaultReports, {
      headers: {
        'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    })
  } catch (e) {
    console.error('Failed to parse cached report', e)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
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
