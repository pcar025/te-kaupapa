import type { WorkflowPouId } from '../../shared/workflow'

export type ConversationTerminationReason = 'user_ended' | 'navigation' | 'connection_lost' | 'startup_failed' | 'provider_error' | 'provider_id_mismatch'
export type ConversationStatus = 'preparing' | 'authorized' | 'active' | 'ended' | 'failed'

export interface ConversationMetadata {
  id: string
  pouId: WorkflowPouId
  status: ConversationStatus
  providerConversationId: string | null
  authorizedAt: string | null
  connectedAt: string | null
  endedAt: string | null
  terminationReason: string | null
  createdAt: string
  updatedAt: string
}

export class ConversationApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code)
    this.name = 'ConversationApiError'
  }
}

// Ending is best-effort reconciliation after the browser has already released
// its own media. It must not remain pending indefinitely on a poor connection.
const END_CONVERSATION_TIMEOUT_MILLISECONDS = 4_000

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ConversationApiError(payload.error ?? 'request_failed', response.status)
  return payload as T
}

export async function startWhakapapaConversation(workflowId: string, idempotencyKey: string): Promise<{
  conversation: ConversationMetadata
  authorization: { transport: 'webrtc'; conversationToken: string }
}> {
  return requestJson(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/conversations`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  })
}

export async function acknowledgeConversationConnected(conversationId: string, providerConversationId: string): Promise<ConversationMetadata> {
  const payload = await requestJson<{ conversation: ConversationMetadata }>(`/api/conversations/${encodeURIComponent(conversationId)}/client-connected`, {
    method: 'POST',
    body: JSON.stringify({ providerConversationId }),
  })
  return payload.conversation
}

export async function endConversation(conversationId: string, reason: ConversationTerminationReason): Promise<ConversationMetadata> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), END_CONVERSATION_TIMEOUT_MILLISECONDS)
  try {
    const payload = await requestJson<{ conversation: ConversationMetadata }>(`/api/conversations/${encodeURIComponent(conversationId)}/end`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      signal: controller.signal,
    })
    return payload.conversation
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function getCurrentWhakapapaConversation(workflowId: string): Promise<ConversationMetadata | null> {
  const payload = await requestJson<{ conversation: ConversationMetadata | null }>(`/api/workflows/${encodeURIComponent(workflowId)}/pou/whakapapa/conversation`)
  return payload.conversation
}
