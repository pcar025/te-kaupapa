import { describe, expect, it } from 'vitest'

import { checkLocalLiveRuntime, listenersFromLsof } from './check-local-live-runtime.js'

describe('local live-test runtime preflight', () => {
  it('accepts exactly one approved loopback listener for every required service', () => {
    const responses = new Map<string, string>([
      ['lsof -nP -iTCP:3011 -sTCP:LISTEN -Fpn', 'p101\nn127.0.0.1:3011\n'],
      ['lsof -nP -iTCP:3012 -sTCP:LISTEN -Fpn', 'p102\nn127.0.0.1:3012\n'],
      ['lsof -nP -iTCP:8443 -sTCP:LISTEN -Fpn', 'p103\nn127.0.0.1:8443\n'],
      ['ps -p 101 -o command=', 'node --env-file=.env --import tsx server/index.ts\n'],
      ['ps -p 102 -o command=', 'node --import tsx server/scripts/relay-elevenlabs-webhook.ts\n'],
      ['ps -p 103 -o command=', 'node node_modules/.bin/vite --host 127.0.0.1\n'],
    ])
    expect(checkLocalLiveRuntime((command, args) => responses.get(`${command} ${args.join(' ')}`) ?? '')).toEqual([])
  })

  it('fails closed for duplicate or broad listeners', () => {
    const output = 'p101\nn127.0.0.1:3011\np202\nn*:3011\n'
    const listeners = listenersFromLsof(output, new Map([[101, 'node server/index.ts'], [202, 'node server/index.ts']]))
    expect(listeners).toHaveLength(2)
    const responses = new Map<string, string>([
      ['lsof -nP -iTCP:3011 -sTCP:LISTEN -Fpn', output],
      ['lsof -nP -iTCP:3012 -sTCP:LISTEN -Fpn', 'p102\nn127.0.0.1:3012\n'],
      ['lsof -nP -iTCP:8443 -sTCP:LISTEN -Fpn', 'p103\nn127.0.0.1:8443\n'],
      ['ps -p 101 -o command=', 'node server/index.ts\n'], ['ps -p 202 -o command=', 'node server/index.ts\n'],
      ['ps -p 102 -o command=', 'node relay-elevenlabs-webhook.ts\n'], ['ps -p 103 -o command=', 'node vite\n'],
    ])
    expect(checkLocalLiveRuntime((command, args) => responses.get(`${command} ${args.join(' ')}`) ?? '')).toEqual([expect.stringContaining('Fastify on 3011')])
  })
})
