import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import db from '../../db'
import { detectTvlGaps } from './detector'

export const runtime = 'nodejs'

function isAuthenticated(request: NextRequest): boolean {
  const apiKey = process.env.MONITOR_API_KEY
  if (!apiKey) return false

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice(7)

  const encoder = new TextEncoder()
  const tokenBuf = encoder.encode(token)
  const keyBuf = encoder.encode(apiKey)
  if (tokenBuf.length !== keyBuf.length) return false

  return timingSafeEqual(tokenBuf, keyBuf)
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const minTvl = Number(searchParams.get('minTvl') ?? 500)
  const startDaysAgo = Number(searchParams.get('start') ?? 60)

  if (isNaN(minTvl) || isNaN(startDaysAgo)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const gaps = await detectTvlGaps(db, { minTvl, startDaysAgo })

  if (gaps.length === 0) {
    return NextResponse.json({ status: 'ok' })
  }

  return NextResponse.json({ status: 'gaps-detected', gaps })
}
