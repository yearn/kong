import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: [
    '/api/mq/:function*'
  ]
}

export function middleware(request: NextRequest) {
  if (request.method === 'OPTIONS') { return NextResponse.next() }

  const expectedAuth = process.env.APP_API_AUTH
  if(expectedAuth === undefined) { return NextResponse.next() }

  const auth = request.headers.get('auth')
  if(!auth) { return new NextResponse(null, { status: 401 }) }
  
  if(auth !== expectedAuth) { return new NextResponse(null, { status: 403 }) }
  return NextResponse.next()
}
