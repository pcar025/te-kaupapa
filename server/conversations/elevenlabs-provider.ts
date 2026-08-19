import { z } from 'zod'

import type { ConversationProvider, ProviderAuthorizationRequest, ProviderConversationAuthorization } from './provider.js'
import { ConversationProviderAuthorizationError } from './provider.js'

const authorizationSchema = z.object({
  token: z.string().min(1),
  conversation_id: z.string().min(1),
})

type FetchImplementation = typeof fetch

export class ElevenLabsConversationProvider implements ConversationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMilliseconds = 10_000,
  ) {}

  async authorizeConversation(input: ProviderAuthorizationRequest): Promise<ProviderConversationAuthorization> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds)
    try {
      const query = new URLSearchParams({ agent_id: input.agentId, branch_id: input.branchId, environment: input.environment })
      const response = await this.fetchImplementation(`https://api.elevenlabs.io/v1/convai/conversation/token?${query.toString()}`, {
        method: 'GET',
        headers: { 'xi-api-key': this.apiKey, accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new ConversationProviderAuthorizationError()
      const parsed = authorizationSchema.safeParse(await response.json())
      if (!parsed.success) throw new ConversationProviderAuthorizationError()
      return {
        providerConversationId: parsed.data.conversation_id,
        conversationToken: parsed.data.token,
      }
    } catch (error) {
      if (error instanceof ConversationProviderAuthorizationError) throw error
      throw new ConversationProviderAuthorizationError()
    } finally {
      clearTimeout(timeout)
    }
  }
}
