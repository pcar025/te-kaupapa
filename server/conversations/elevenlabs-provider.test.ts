import { describe, expect, it, vi } from 'vitest'

import { ElevenLabsConversationProvider } from './elevenlabs-provider.js'
import { ConversationProviderAuthorizationError } from './provider.js'

const input = { agentId: 'agent-test', branchId: 'branch-test', environment: 'staging' }

describe('ElevenLabsConversationProvider', () => {
  it('uses only the server API key and returns the bounded authorization material', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ token: 'temporary-token', conversation_id: 'provider-conversation' }), { status: 200 })) as unknown as typeof fetch
    const provider = new ElevenLabsConversationProvider('server-only-secret', fetchImplementation)
    await expect(provider.authorizeConversation(input)).resolves.toEqual({ conversationToken: 'temporary-token', providerConversationId: 'provider-conversation' })
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent-test&branch_id=branch-test&environment=staging',
      expect.objectContaining({ headers: { 'xi-api-key': 'server-only-secret', accept: 'application/json' } }),
    )
  })

  it.each([
    async () => new Response('{}', { status: 503 }),
    async () => new Response('{not-json', { status: 200 }),
    async () => new Response(JSON.stringify({ token: 'only-token' }), { status: 200 }),
  ])('returns a bounded error for provider failures without exposing response details', async (response) => {
    const provider = new ElevenLabsConversationProvider('server-only-secret', vi.fn(response) as unknown as typeof fetch)
    await expect(provider.authorizeConversation(input)).rejects.toEqual(expect.any(ConversationProviderAuthorizationError))
  })

  it('maps aborted requests to the same bounded provider error', async () => {
    const provider = new ElevenLabsConversationProvider('server-only-secret', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }) as unknown as typeof fetch)
    await expect(provider.authorizeConversation(input)).rejects.toEqual(expect.any(ConversationProviderAuthorizationError))
  })
})
