import { createServer } from 'node:http'
import handler from './index.js'

const port = Number(process.env.PORT ?? 8787)

createServer(async (incoming, outgoing) => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (key.toLowerCase().startsWith('x-neon-')) continue
    if (Array.isArray(value)) headers.set(key, value.join(', '))
    else if (value !== undefined) headers.set(key, value)
  }
  const chunks: Buffer[] = []
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const request = new Request(`http://${incoming.headers.host ?? `localhost:${port}`}${incoming.url ?? '/'}`, {
    method: incoming.method,
    headers,
    body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : body,
  })
  const response = await handler.fetch(request)
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  outgoing.end(Buffer.from(await response.arrayBuffer()))
}).listen(port, '127.0.0.1', () => {
  console.log(`neon-rest-cache local handler listening on http://localhost:${port}`)
})
