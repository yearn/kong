import { NextResponse } from 'next/server'
import { createKeyv } from '@keyv/redis'

export const runtime = 'nodejs'

const REDIS_LIST_KEY = 'list:vaults'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
}

const redisUrl = process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379'
const listsKeyv = createKeyv(redisUrl)

export async function GET() {
  let cached
  try {
    cached = await listsKeyv.get(REDIS_LIST_KEY)
  } catch (err) {
    console.error(`Redis read failed for ${REDIS_LIST_KEY}:`, err)
    throw err
  }

  if (!cached) {
    return new NextResponse('Not found', { status: 404, headers: corsHeaders })
  }

  const parsed = JSON.parse(cached as string)

  return NextResponse.json(parsed, {
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
