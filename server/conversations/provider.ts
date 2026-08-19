export interface ProviderAuthorizationRequest {
  agentId: string
  branchId: string
  environment: string
}

export interface ProviderConversationAuthorization {
  providerConversationId: string
  conversationToken: string
}

export interface ConversationProvider {
  authorizeConversation(input: ProviderAuthorizationRequest): Promise<ProviderConversationAuthorization>
}

export class ConversationProviderUnavailableError extends Error {
  constructor() {
    super('The conversation provider is unavailable.')
    this.name = 'ConversationProviderUnavailableError'
  }
}

export class ConversationProviderAuthorizationError extends Error {
  constructor() {
    super('The conversation provider could not authorize a conversation.')
    this.name = 'ConversationProviderAuthorizationError'
  }
}
