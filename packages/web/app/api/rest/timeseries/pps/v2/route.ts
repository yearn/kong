import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { parsePpsBatchRequest } from './contract'
import { readPpsBatch } from './service'

export const runtime = 'nodejs'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type',
}
const MAX_REQUEST_BYTES = 16 * 1_024
const MAX_RESPONSE_BYTES = 4_000_000

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: corsHeaders },
  )
}

export async function POST(request: Request) {
  let body: unknown

  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return errorResponse('Request body is too large', 413)
    }

    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse('Request body is too large', 413)
    }

    body = JSON.parse(bodyText)
  } catch {
    return errorResponse('Invalid JSON', 400)
  }

  const parsed = parsePpsBatchRequest(body)
  if (!parsed.success) {
    return errorResponse(parsed.error, 400)
  }

  try {
    const response = await readPpsBatch(parsed.data)
    const serialized = JSON.stringify(response)
    if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) {
      return errorResponse('Response is too large; reduce the range or address count', 413)
    }

    return new NextResponse(serialized, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...corsHeaders,
      },
    })
  } catch (error) {
    console.error('PPS batch read failed:', error)
    return errorResponse('Internal server error', 500)
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
