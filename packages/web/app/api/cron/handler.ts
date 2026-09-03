import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

function isAuthenticated(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false

  const encoder = new TextEncoder()
  const tokenBuf = encoder.encode(authHeader.slice(7))
  const secretBuf = encoder.encode(secret)
  if (tokenBuf.length !== secretBuf.length) return false

  return timingSafeEqual(tokenBuf, secretBuf)
}

export function createCronHandler(job: () => Promise<void>, kumaEnvVar: string) {
  return async function GET(request: Request) {
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    try {
      await job()
      await pushUptimeKuma(kumaEnvVar, 'up', 'OK')
      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error(error)
      await pushUptimeKuma(kumaEnvVar, 'down', 'Run failed')
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }
}

async function pushUptimeKuma(envVar: string, status: 'up' | 'down', msg: string) {
  const url = process.env[envVar]
  if (!url) return
  try {
    const response = await fetch(`${url}?status=${status}&msg=${encodeURIComponent(msg)}`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) console.error(`uptime kuma push failed (${envVar}): HTTP ${response.status}`)
  } catch (error) {
    console.error(`uptime kuma push failed (${envVar})`, error)
  }
}
