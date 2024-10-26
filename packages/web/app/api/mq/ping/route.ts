
export async function POST() {
  return new Response(JSON.stringify({ pong: new Date().toISOString() }))
}
