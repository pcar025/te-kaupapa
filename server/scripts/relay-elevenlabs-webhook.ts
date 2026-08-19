import { createServer, request } from 'node:http'

const host = '127.0.0.1'
const port = 3012
const targetHost = '127.0.0.1'
const targetPort = 3011
const path = '/api/integrations/elevenlabs/post-call'
const maximumBodyBytes = 131072

const relay = createServer((incoming, outgoing) => {
  if (incoming.method !== 'POST' || incoming.url !== path) {
    outgoing.writeHead(404).end()
    return
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  let rejected = false
  incoming.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length
    if (receivedBytes > maximumBodyBytes) {
      rejected = true
      outgoing.writeHead(413).end()
      incoming.destroy()
      return
    }
    chunks.push(chunk)
  })
  incoming.on('end', () => {
    if (rejected) return
    const body = Buffer.concat(chunks)
    const upstream = request({ host: targetHost, port: targetPort, path, method: 'POST', headers: {
      'content-type': incoming.headers['content-type'] ?? 'application/json',
      'content-length': body.length,
      'elevenlabs-signature': incoming.headers['elevenlabs-signature'] ?? '',
    } }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, { 'content-type': response.headers['content-type'] ?? 'application/json' })
      response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.writeHead(502).end())
    upstream.end(body)
  })
})

relay.listen(port, host)
