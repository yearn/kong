export async function GET() {
  return new Response(JSON.stringify({ pong: new Date().toISOString() }))
}
